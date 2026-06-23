import { Job } from 'bullmq';
import { sql } from '../index.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml:8000';

interface ScoringJob {
  pipelineRunId?: string;
  profileIds?: string[];
  limit?: number;
  useML?: boolean;
}

export async function scoringWorker(job: Job<ScoringJob>) {
  const { pipelineRunId, profileIds, limit = 100, useML = true } = job.data;

  console.log(`🎯 Scoring: ${profileIds?.length || limit} profiles (ML: ${useML})`);

  // Get profiles to score
  const profiles = profileIds?.length
    ? await sql`SELECT * FROM profiles WHERE id = ANY(${profileIds}::uuid[])`
    : pipelineRunId
      ? await sql`SELECT * FROM profiles WHERE discovery_batch_id = ${pipelineRunId} AND score = 0`
      : await sql`SELECT * FROM profiles WHERE score = 0 LIMIT ${limit}`;

  if (profiles.length === 0) {
    return { scored: 0, message: 'No profiles to score' };
  }

  const stats = {
    scored: 0,
    highPriority: 0,
    mlScored: 0,
    heuristicScored: 0,
    nicheBreakdown: {} as Record<string, number>
  };

  // Try ML scoring first
  if (useML) {
    try {
      const mlProfiles = profiles.map(p => ({
        username: p.username,
        bio: p.bio || '',
        followers: p.followers || 0,
        following: p.following || 0,
        posts_count: p.posts_count || 0,
        is_private: p.is_private || false,
        is_verified: p.is_verified || false,
        is_business: p.is_business || false,
        external_url: p.external_url || '',
        captions: ((p.latest_posts || []) as any[]).map((lp: any) => lp.caption || '').filter(Boolean),
        engagement_rate: p.engagement_rate || null,
        avg_likes: p.avg_likes || null
      }));

      const mlRes = await fetch(`${ML_SERVICE_URL}/ml/score/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: mlProfiles }),
        signal: AbortSignal.timeout(30000)
      });

      if (mlRes.ok) {
        const mlResults = await mlRes.json();

        for (const result of mlResults) {
          const profile = profiles.find(p => p.username === result.username);
          if (!profile) continue;

          await sql`
            UPDATE profiles
            SET niche_id = ${result.niche},
                score = ${Math.round(result.score)},
                score_details = ${JSON.stringify({
                  icp_class: result.icp_class,
                  signals: result.signals,
                  explanation: result.explanation,
                  method: 'ml_model',
                  niche_confidence: result.niche_confidence
                })}::jsonb,
                status = CASE WHEN status = 'discovered' THEN 'nuevo' ELSE status END,
                updated_at = NOW()
            WHERE id = ${profile.id}
          `;

          stats.scored++;
          stats.mlScored++;
          stats.nicheBreakdown[result.niche] = (stats.nicheBreakdown[result.niche] || 0) + 1;
          if (result.score >= 70) stats.highPriority++;
        }

        console.log(`🧠 ML scored ${stats.mlScored} profiles`);

        // Score remaining with heuristics
        const remaining = profiles.filter(p =>
          !mlResults.find((r: any) => r.username === p.username)
        );
        if (remaining.length > 0) {
          const hStats = await heuristicScore(remaining);
          stats.scored += hStats.scored;
          stats.heuristicScored = hStats.scored;
          stats.highPriority += hStats.highPriority;
          for (const [k, v] of Object.entries(hStats.nicheBreakdown)) {
            stats.nicheBreakdown[k] = (stats.nicheBreakdown[k] || 0) + v;
          }
        }
      } else {
        console.warn(`⚠️ ML service returned ${mlRes.status}, falling back to heuristic`);
        const hStats = await heuristicScore(profiles);
        stats.scored = hStats.scored;
        stats.heuristicScored = hStats.scored;
        stats.highPriority = hStats.highPriority;
        stats.nicheBreakdown = hStats.nicheBreakdown;
      }
    } catch (err: any) {
      console.warn(`⚠️ ML service unavailable: ${err.message} — using heuristic scoring`);
      const hStats = await heuristicScore(profiles);
      stats.scored = hStats.scored;
      stats.heuristicScored = hStats.scored;
      stats.highPriority = hStats.highPriority;
      stats.nicheBreakdown = hStats.nicheBreakdown;
    }
  } else {
    const hStats = await heuristicScore(profiles);
    stats.scored = hStats.scored;
    stats.heuristicScored = hStats.scored;
    stats.highPriority = hStats.highPriority;
    stats.nicheBreakdown = hStats.nicheBreakdown;
  }

  // Update daily stats
  if (stats.scored > 0) {
    await sql.unsafe(`
      INSERT INTO daily_stats (date, discovered)
      VALUES (CURRENT_DATE, ${stats.scored})
      ON CONFLICT (date) DO UPDATE SET discovered = daily_stats.discovered + ${stats.scored}
    `);
  }

  return stats;
}

async function heuristicScore(profiles: any[]) {
  const niches = await sql`SELECT * FROM niches`;
  const stats = { scored: 0, highPriority: 0, nicheBreakdown: {} as Record<string, number> };

  for (const profile of profiles) {
    const bio = (profile.bio || '').toLowerCase();
    let bestNiche: any = null;
    let bestHits = 0;

    for (const niche of niches) {
      if (niche.id === 'otro') continue;
      const keywords: string[] = niche.keywords || [];
      let hits = 0;
      for (const kw of keywords) {
        if (bio.includes(kw.toLowerCase())) hits++;
      }
      if (hits > 0 && (!bestNiche || hits * niche.weight > bestHits * (bestNiche?.weight || 0))) {
        bestNiche = niche; bestHits = hits;
      }
    }

    const niche = bestNiche || niches.find((n: any) => n.id === 'otro');
    let score = (niche?.weight || 25) * Math.min(1, 0.55 + bestHits * 0.15);
    const followers = profile.followers || 0;

    if (followers >= 3000 && followers <= 200000) score += 12;
    else if (followers > 200000) score -= 5;
    else if (followers < 500) score -= 20;

    const posts = profile.posts_count || 0;
    if (posts >= 9) score += 5; else score -= 5;

    if (profile.is_verified) score += 10;
    if (profile.external_url) score += 8;
    if (profile.is_business) score += 5;
    if (profile.is_private) score -= 40;

    const signals: string[] = profile.manual_signals || [];
    score += signals.length * 4;
    if (profile.engagement_rate && profile.engagement_rate > 0.01) score += 5;
    if (profile.avg_likes && profile.avg_likes > 50) score += 3;

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));

    await sql`
      UPDATE profiles
      SET niche_id = ${niche.id}, score = ${finalScore},
          score_details = ${JSON.stringify({ method: 'heuristic', keywordHits: bestHits })}::jsonb,
          status = CASE WHEN status = 'discovered' THEN 'nuevo' ELSE status END,
          updated_at = NOW()
      WHERE id = ${profile.id}
    `;

    stats.scored++;
    stats.nicheBreakdown[niche.id] = (stats.nicheBreakdown[niche.id] || 0) + 1;
    if (finalScore >= 70) stats.highPriority++;
  }

  return stats;
}
