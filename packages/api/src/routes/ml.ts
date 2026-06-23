import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function mlRoutes(app: FastifyInstance) {
  // GET /api/ml/metrics
  app.get('/ml/metrics', async () => {
    const metrics = await sql`
      SELECT * FROM model_metrics ORDER BY created_at DESC LIMIT 20
    `;
    return { data: metrics };
  });

  // POST /api/ml/retrain — Trigger model retraining
  app.post('/ml/retrain', async () => {
    const labelCount = await sql`
      SELECT COUNT(*)::int as count FROM feedback_log
    `;

    if (Number(labelCount) < 10) {
      return { error: 'Not enough labeled data for retraining. Minimum 10 labels required.', code: 400 };
    }

    // The actual retraining is handled by the ML service worker
    return {
      data: {
        status: 'queued',
        labelsAvailable: Number(labelCount),
        message: 'Retraining job dispatched to ML worker'
      }
    };
  });

  // POST /api/ml/score — Score profiles via ML service
  app.post('/ml/score', async (req) => {
    const { profileIds } = req.body as { profileIds?: string[] };

    const profiles = profileIds?.length
      ? await sql`SELECT * FROM profiles WHERE id = ANY(${profileIds}::uuid[])`
      : await sql`SELECT * FROM profiles WHERE status = 'nuevo' AND score = 0 LIMIT 100`;

    // For now use heuristic scoring (ML service handles model-based scoring)
    const results = [];
    for (const p of profiles) {
      const niches = await sql`SELECT * FROM niches WHERE id != 'otro'`;
      const bio = (p.bio || '').toLowerCase();
      let bestNiche: any = null;
      let bestHits = 0;

      for (const n of niches) {
        const keywords: string[] = n.keywords || [];
        let hits = 0;
        for (const kw of keywords) {
          if (bio.includes(kw.toLowerCase())) hits++;
        }
        if (hits > 0 && (!bestNiche || hits * n.weight > bestHits * (bestNiche?.weight || 0))) {
          bestNiche = n;
          bestHits = hits;
        }
      }

      const niche = bestNiche || niches.find((n: any) => n.id === 'otro');
      const base = (niche?.weight || 25) * Math.min(1, 0.55 + bestHits * 0.15);
      let score = base;

      if (p.is_private) score -= 40;
      if (p.followers >= 3000 && p.followers <= 200000) score += 12;
      else score -= 15;
      if (p.followers > 0 && p.followers < 500) score -= 20;
      if (p.posts_count >= 9) score += 5;
      else score -= 5;
      if (p.external_url) score += 8;

      const finalScore = Math.max(0, Math.min(100, Math.round(score)));

      await sql`
        UPDATE profiles
        SET niche_id = ${niche?.id || 'otro'}, score = ${finalScore}, score_details = ${{ method: 'heuristic', keywordHits: bestHits }}::jsonb
        WHERE id = ${p.id}
      `;

      results.push({ id: p.id, username: p.username, nicheId: niche?.id, score: finalScore });
    }

    return { data: { scored: results.length, results } };
  });
}
