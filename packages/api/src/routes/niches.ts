import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function nicheRoutes(app: FastifyInstance) {
  // GET /api/niches
  app.get('/niches', async () => {
    const niches = await sql`
      SELECT n.*,
        (SELECT COUNT(*)::int FROM profiles p WHERE p.niche_id = n.id) as profile_count,
        (SELECT COUNT(*)::int FROM customers c WHERE c.niche_id = n.id) as customer_count
      FROM niches n
      ORDER BY n.weight DESC
    `;

    // Get stats for each niche
    const result = [];
    for (const n of niches) {
      const [stats] = await sql`
        SELECT
          COUNT(*)::int as total_feedback,
          COUNT(*) FILTER (WHERE f.action IN ('aprobado','contactado','cliente'))::int as approved,
          COUNT(*) FILTER (WHERE f.action = 'cliente')::int as clients
        FROM feedback_log f
        JOIN profiles p ON f.profile_id = p.id
        WHERE p.niche_id = ${n.id}
      `;

      result.push({
        ...n,
        stats: {
          totalFeedback: stats.total_feedback,
          approvalRate: stats.total_feedback > 0 ? stats.approved / stats.total_feedback : null,
          conversionRate: stats.total_feedback > 0 ? stats.clients / stats.total_feedback : null
        }
      });
    }

    return { data: result };
  });

  // GET /api/niches/:id/stats
  app.get('/niches/:id/stats', async (req) => {
    const { id } = req.params as { id: string };
    const [stats] = await sql`
      SELECT
        COUNT(*)::int as total_feedback,
        COUNT(*) FILTER (WHERE f.action IN ('aprobado','contactado','cliente'))::int as approved,
        COUNT(*) FILTER (WHERE f.action = 'cliente')::int as clients,
        COUNT(*) FILTER (WHERE f.action = 'descartado')::int as rejected
      FROM feedback_log f
      JOIN profiles p ON f.profile_id = p.id
      WHERE p.niche_id = ${id}
    `;
    return { data: stats };
  });

  // PUT /api/niches/:id/weight — Manual weight adjustment
  app.put('/niches/:id/weight', async (req) => {
    const { id } = req.params as { id: string };
    const { weight, delta } = req.body as { weight?: number; delta?: number };

    if (delta) {
      await sql`
        UPDATE niches
        SET weight = GREATEST(0, LEAST(100, weight + ${delta})), updated_at = NOW()
        WHERE id = ${id}
      `;
    } else if (weight !== undefined) {
      await sql`
        UPDATE niches SET weight = GREATEST(0, LEAST(100, ${weight})), updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    const [niche] = await sql`SELECT * FROM niches WHERE id = ${id}`;
    return { data: niche };
  });

  // PUT /api/niches/:id/keywords
  app.put('/niches/:id/keywords', async (req) => {
    const { id } = req.params as { id: string };
    const { keywords } = req.body as { keywords: string[] };

    await sql`UPDATE niches SET keywords = ${keywords}, updated_at = NOW() WHERE id = ${id}`;
    const [niche] = await sql`SELECT * FROM niches WHERE id = ${id}`;
    return { data: niche };
  });

  // POST /api/niches/recalc — Recalculate all niche weights
  app.post('/niches/recalc', async () => {
    const niches = await sql`SELECT * FROM niches WHERE id != 'otro'`;

    const rates: { id: string; approvalRate: number; conversionRate: number }[] = [];
    for (const n of niches) {
      const [stats] = await sql`
        SELECT
          COUNT(*)::float as total,
          COUNT(*) FILTER (WHERE f.action IN ('aprobado','contactado','cliente'))::float as approved,
          COUNT(*) FILTER (WHERE f.action = 'cliente')::float as clients
        FROM feedback_log f
        JOIN profiles p ON f.profile_id = p.id
        WHERE p.niche_id = ${n.id}
      `;

      if (stats.total > 0) {
        rates.push({
          id: n.id,
          approvalRate: stats.approved / stats.total,
          conversionRate: stats.clients / stats.total
        });
      }
    }

    if (rates.length === 0) return { message: 'No feedback data to recalculate', data: niches };

    const avgApproval = rates.reduce((s, r) => s + r.approvalRate, 0) / rates.length;
    const avgConv = rates.reduce((s, r) => s + r.conversionRate, 0) / rates.length;

    const updated = [];
    for (const n of niches) {
      const r = rates.find(rt => rt.id === n.id);
      if (r) {
        const delta = (r.approvalRate - avgApproval) * 35 + (r.conversionRate - avgConv) * 55;
        const newWeight = Math.max(10, Math.min(100, Math.round(n.weight + delta)));
        await sql`UPDATE niches SET weight = ${newWeight}, updated_at = NOW() WHERE id = ${n.id}`;
        updated.push({ id: n.id, oldWeight: n.weight, newWeight, delta: Math.round(delta) });
      }
    }

    return { message: 'Weights recalculated', data: updated };
  });
}
