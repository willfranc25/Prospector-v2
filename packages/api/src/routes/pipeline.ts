import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function pipelineRoutes(app: FastifyInstance) {
  // GET /api/pipeline/runs
  app.get('/pipeline/runs', async (req) => {
    const { limit = '20', status } = req.query as Record<string, string>;

    const conditions: string[] = [];
    if (status) conditions.push(`status = '${status}'`);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const runs = await sql.unsafe(`
      SELECT * FROM pipeline_runs ${where}
      ORDER BY created_at DESC LIMIT ${Number(limit)}
    `);

    return { data: runs };
  });

  // GET /api/pipeline/runs/:id
  app.get('/pipeline/runs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [run] = await sql`SELECT * FROM pipeline_runs WHERE id = ${id}`;
    if (!run) return { error: 'Run not found', code: 404 };

    // Get profiles discovered in this run
    const profiles = await sql`
      SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status = 'nuevo')::int as nuevo,
             COUNT(*) FILTER (WHERE status IN ('aprobado','contactado','cliente'))::int as aprobado,
             COUNT(*) FILTER (WHERE status = 'descartado')::int as descartado
      FROM profiles WHERE discovery_batch_id = ${id}
    `;

    return { data: { ...run, outcome: profiles[0] } };
  });

  // GET /api/pipeline/strategies
  app.get('/pipeline/strategies', async () => {
    const strategies = await sql`
      SELECT * FROM discovery_strategies ORDER BY priority DESC
    `;
    return { data: strategies };
  });

  // PUT /api/pipeline/strategies/:id
  app.put('/pipeline/strategies/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { enabled, config, priority } = req.body as any;

    const updates: string[] = [];
    if (enabled !== undefined) updates.push(`enabled = ${enabled}`);
    if (config) updates.push(`config = '${JSON.stringify(config)}'`);
    if (priority !== undefined) updates.push(`priority = ${priority}`);

    if (updates.length > 0) {
      await sql.unsafe(`UPDATE discovery_strategies SET ${updates.join(', ')} WHERE id = '${id}'`);
    }

    const [strategy] = await sql`SELECT * FROM discovery_strategies WHERE id = ${id}`;
    return { data: strategy };
  });

  // GET /api/pipeline/daily-stats
  app.get('/pipeline/daily-stats', async (req) => {
    const { days = '14' } = req.query as Record<string, string>;

    const stats = await sql.unsafe(`
      SELECT * FROM daily_stats
      WHERE date >= CURRENT_DATE - INTERVAL '${Number(days)} days'
      ORDER BY date ASC
    `);

    return { data: stats };
  });

  // GET /api/pipeline/funnel
  app.get('/pipeline/funnel', async () => {
    const [funnel] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status IN ('aprobado','contactado','cliente'))::int as aprobado,
        COUNT(*) FILTER (WHERE status IN ('contactado','cliente'))::int as contactado,
        COUNT(*) FILTER (WHERE status = 'cliente')::int as cliente,
        COUNT(*) FILTER (WHERE status = 'descartado')::int as descartado,
        COUNT(*) FILTER (WHERE status = 'nuevo')::int as nuevo
      FROM profiles
    `;

    const total = funnel.total;
    return {
      data: {
        steps: [
          { label: 'Descubiertos', value: total, pct: 100 },
          { label: 'Aprobados', value: funnel.aprobado, pct: total > 0 ? Math.round(funnel.aprobado / total * 100) : 0 },
          { label: 'Contactados', value: funnel.contactado, pct: total > 0 ? Math.round(funnel.contactado / total * 100) : 0 },
          { label: 'Clientes', value: funnel.cliente, pct: total > 0 ? Math.round(funnel.cliente / total * 100) : 0 }
        ],
        rejected: funnel.descartado,
        pending: funnel.nuevo
      }
    };
  });
}
