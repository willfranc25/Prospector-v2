import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function statsRoutes(app: FastifyInstance) {
  // GET /api/stats/overview
  app.get('/stats/overview', async () => {
    const [counts] = await sql`
      SELECT
        COUNT(*)::int as total_profiles,
        COUNT(*) FILTER (WHERE status = 'nuevo')::int as pending,
        COUNT(*) FILTER (WHERE status IN ('aprobado','contactado','cliente'))::int as approved,
        COUNT(*) FILTER (WHERE status = 'contactado')::int as contacted,
        COUNT(*) FILTER (WHERE status = 'cliente')::int as clients,
        COUNT(*) FILTER (WHERE status = 'descartado')::int as rejected,
        COUNT(*) FILTER (WHERE score >= 70)::int as high_priority,
        AVG(score)::real as avg_score
      FROM profiles
    `;

    const [customersCount] = await sql`SELECT COUNT(*)::int as total FROM customers`;
    const [recentFeedback] = await sql`
      SELECT COUNT(*)::int as count FROM feedback_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    return {
      data: {
        profiles: counts,
        customers: customersCount.total,
        feedback24h: recentFeedback.count,
        pipeline: {
          approvalRate: counts.total_profiles > 0
            ? Math.round((counts.approved || 0) / (counts.total_profiles - (counts.pending || 0)) * 100)
            : 0
        }
      }
    };
  });

  // GET /api/stats/throughput
  app.get('/stats/throughput', async () => {
    const [hourly] = await sql`
      SELECT
        COUNT(*)::real as actions,
        EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 3600 as hours_span
      FROM feedback_log
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `;

    const rate = hourly.hours_span > 0
      ? Math.round(hourly.actions / Math.max(hourly.hours_span, 0.05))
      : null;

    const benchmark = 125; // manual: 500/4h

    return {
      data: {
        currentRate: rate,
        benchmark,
        multiplier: rate ? (rate / benchmark).toFixed(1) : null,
        actionsLastHour: hourly.actions
      }
    };
  });

  // GET /api/stats/niche-breakdown
  app.get('/stats/niche-breakdown', async () => {
    const breakdown = await sql`
      SELECT
        n.id, n.label, n.weight,
        COUNT(p.id)::int as profile_count,
        COUNT(p.id) FILTER (WHERE p.status IN ('aprobado','contactado','cliente'))::int as approved,
        COUNT(p.id) FILTER (WHERE p.status = 'cliente')::int as clients
      FROM niches n
      LEFT JOIN profiles p ON p.niche_id = n.id
      GROUP BY n.id, n.label, n.weight
      ORDER BY n.weight DESC
    `;

    return { data: breakdown };
  });
}
