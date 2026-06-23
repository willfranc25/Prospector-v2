import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';
import { z } from 'zod';

// Simple CSV parser (handles quoted fields)
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { out.push(cur.trim()); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h.includes('user')) colMap.username = i;
    else if (h.includes('bio')) colMap.bio = i;
    else if (h.includes('follow')) colMap.followers = i;
    else if (h.includes('post') || h.includes('publicac')) colMap.posts = i;
    else if (h.includes('private') || h.includes('privad')) colMap.isPrivate = i;
    else if (h.includes('url') || h.includes('link') || h.includes('website')) colMap.externalUrl = i;
    else if (h.includes('name') || h.includes('nombre')) colMap.fullName = i;
    else if (h.includes('verif')) colMap.isVerified = i;
  });

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    if (colMap.username !== undefined && cells[colMap.username]) {
      rows.push({
        username: cells[colMap.username]?.replace(/^@/, '') || '',
        bio: colMap.bio !== undefined ? (cells[colMap.bio] || '') : '',
        followers: colMap.followers !== undefined ? (cells[colMap.followers] || '0') : '0',
        posts: colMap.posts !== undefined ? (cells[colMap.posts] || '0') : '0',
        isPrivate: colMap.isPrivate !== undefined
          ? String(/true|1|sí|si/i.test(cells[colMap.isPrivate] || ''))
          : 'false',
        externalUrl: colMap.externalUrl !== undefined ? (cells[colMap.externalUrl] || '') : '',
        fullName: colMap.fullName !== undefined ? (cells[colMap.fullName] || '') : '',
        isVerified: colMap.isVerified !== undefined
          ? String(/true|1|sí|si/i.test(cells[colMap.isVerified] || ''))
          : 'false'
      });
    }
  }

  return rows;
}

// Discard keywords filter
const DISCARD_KEYWORDS = [
  'agencia de marketing', 'agencia digital', 'social media agency', 'growth agency',
  'agencia creativa', 'marketing agency', 'memes', 'shitpost', 'noticias',
  '13 años', '14 años', '15 años', 'estudiante de secundaria'
];

// Spanish stopwords for language detection
const SPANISH_STOPWORDS = [' de ', ' que ', ' la ', ' el ', ' en ', ' y ', ' a ', ' los ', ' se ', ' del ', ' por ', ' con ', ' para ', ' una ', ' un '];

const ImportRowSchema = z.object({
  username: z.string().min(1),
  bio: z.string().optional().default(''),
  followers: z.string().optional().default('0'),
  posts: z.string().optional().default('0'),
  isPrivate: z.string().optional().default('false'),
  externalUrl: z.string().optional().default(''),
  fullName: z.string().optional().default(''),
  isVerified: z.string().optional().default('false')
});

export async function importRoutes(app: FastifyInstance) {
  // POST /api/import/csv
  app.post('/import/csv', async (req) => {
    const { csv, source = 'csv_upload', seedId } = req.body as {
      csv: string;
      source?: string;
      seedId?: string;
    };

    if (!csv?.trim()) return { error: 'Empty CSV', code: 400 };

    const rows = parseCSV(csv);
    if (rows.length === 0) return { error: 'No valid rows found', code: 400 };

    // Get filters
    const [filterRow] = await sql`SELECT value FROM settings WHERE key = 'filters'`;
    const filters = filterRow?.value || {};

    const minFollowers = filters.minFollowers || 3000;
    const maxFollowers = filters.maxFollowers || 200000;
    const minPosts = filters.minPosts || 9;

    // Get existing usernames
    const existingRows = await sql`SELECT username FROM profiles`;
    const existingUsernames = new Set(existingRows.map((r: any) => r.username.toLowerCase()));
    const customerRows = await sql`SELECT username FROM customers`;
    const customerUsernames = new Set(customerRows.map((r: any) => r.username.toLowerCase()));

    // Get niches for scoring
    const niches = await sql`SELECT * FROM niches`;

    const stats = {
      total: rows.length,
      passed: 0,
      rejected: 0,
      reasons: {} as Record<string, number>,
      highPriority: 0
    };

    const batchId = `import_${Date.now().toString(36)}`;
    const passed: any[] = [];

    for (const row of rows) {
      const username = row.username.toLowerCase();
      let reason: string | null = null;

      // Filter checks
      if (existingUsernames.has(username)) reason = 'duplicate';
      else if (customerUsernames.has(username)) reason = 'already_customer';
      else if (filters.filterPrivate && row.isPrivate === 'true') reason = 'private';
      else {
        const followers = parseInt(row.followers?.replace(/[^\d]/g, '') || '0');
        if (followers < minFollowers) reason = 'low_followers';
        else if (followers > maxFollowers) reason = 'high_followers';
        else if (filters.filterNoBio && !row.bio?.trim()) reason = 'no_bio';
        else if ((parseInt(row.posts?.replace(/[^\d]/g, '') || '0')) < minPosts) reason = 'low_posts';
        else {
          const bioLower = row.bio?.toLowerCase() || '';
          for (const kw of DISCARD_KEYWORDS) {
            if (bioLower.includes(kw)) { reason = 'discard_content'; break; }
          }
          if (!reason && filters.requireSpanish) {
            let hasSpanish = false;
            for (const word of SPANISH_STOPWORDS) {
              if (bioLower.includes(word)) { hasSpanish = true; break; }
            }
            if (!hasSpanish) reason = 'no_spanish';
          }
        }
      }

      if (reason) {
        stats.rejected++;
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
      } else {
        // Score the profile
        const bio = (row.bio || '').toLowerCase();
        let bestNiche: any = null;
        let bestHits = 0;

        for (const n of niches) {
          if (n.id === 'otro') continue;
          const keywords: string[] = n.keywords || [];
          let hits = 0;
          for (const kw of keywords) {
            if (bio.includes(kw.toLowerCase())) hits++;
          }
          if (hits > 0 && (!bestNiche || hits * n.weight > bestHits * (bestNiche.weight || 0))) {
            bestNiche = n;
            bestHits = hits;
          }
        }

        const niche = bestNiche || niches.find((n: any) => n.id === 'otro');
        const base = (niche?.weight || 25) * Math.min(1, 0.55 + bestHits * 0.15);
        let score = base;
        const followers = parseInt(row.followers?.replace(/[^\d]/g, '') || '0');

        if (row.isPrivate === 'true') score -= 40;
        if (followers >= 3000 && followers <= 200000) score += 12;
        else score -= 15;
        if (followers > 0 && followers < 500) score -= 20;
        if ((parseInt(row.posts?.replace(/[^\d]/g, '') || '0')) >= 9) score += 5;
        else score -= 5;
        if (row.externalUrl) score += 8;

        const finalScore = Math.max(0, Math.min(100, Math.round(score)));

        passed.push({
          username: row.username,
          bio: row.bio || '',
          full_name: row.fullName || '',
          followers: followers,
          posts_count: parseInt(row.posts?.replace(/[^\d]/g, '') || '0'),
          is_private: row.isPrivate === 'true',
          is_verified: row.isVerified === 'true',
          external_url: row.externalUrl || '',
          niche_id: niche?.id || 'otro',
          score: finalScore,
          discovery_source: source,
          discovery_seed_id: seedId || null,
          discovery_batch_id: batchId,
          status: 'nuevo',
          manual_signals: [],
          added_date: new Date().toISOString().slice(0, 10)
        });

        stats.passed++;
        existingUsernames.add(username);
        if (finalScore >= 70) stats.highPriority++;
      }
    }

    // Bulk insert passed profiles
    if (passed.length > 0) {
      // Batch insert in chunks of 100
      for (let i = 0; i < passed.length; i += 100) {
        const chunk = passed.slice(i, i + 100);
        const values = chunk.map((p: any, idx: number) => {
          const base = idx * 12;
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12})`;
        }).join(',');

        const params = chunk.flatMap((p: any) => [
          p.username, p.bio, p.full_name, p.followers, p.posts_count,
          p.is_private, p.is_verified, p.external_url,
          p.niche_id, p.score, p.discovery_source, p.discovery_batch_id
        ]);

        await sql.unsafe(`
          INSERT INTO profiles (username, bio, full_name, followers, posts_count,
            is_private, is_verified, external_url, niche_id, score, discovery_source, discovery_batch_id)
          VALUES ${values}
          ON CONFLICT DO NOTHING
        `, params);
      }

      // Update daily stats
      await sql.unsafe(`
        INSERT INTO daily_stats (date, discovered)
        VALUES (CURRENT_DATE, ${passed.length})
        ON CONFLICT (date) DO UPDATE SET discovered = daily_stats.discovered + ${passed.length}
      `);
    }

    return {
      data: {
        stats,
        batchId,
        rejectionReasons: Object.entries(stats.reasons).map(([k, v]) => ({
          reason: k, count: v
        }))
      }
    };
  });
}
