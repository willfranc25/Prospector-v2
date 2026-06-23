import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function batchRoutes(app: FastifyInstance) {
  // POST /api/batches/generate — Generate a recommended batch
  app.post('/batches/generate', async (req) => {
    const { size = 14, cooldownDays = 14, nicheIds } = req.body as {
      size?: number;
      cooldownDays?: number;
      nicheIds?: string[];
    };

    // Get niches sorted by weight
    const nicheFilter = nicheIds?.length
      ? `AND n.id IN (${nicheIds.map((_, i) => `'${nicheIds[i]}'`).join(',')})`
      : `AND n.id != 'otro'`;

    const niches = await sql.unsafe(`
      SELECT * FROM niches n WHERE 1=1 ${nicheFilter} ORDER BY n.weight DESC
    `);

    if (niches.length === 0) {
      return { data: null, message: 'No niches available' };
    }

    const totalWeight = niches.reduce((sum: number, n: any) => sum + n.weight, 0);
    const picks: any[] = [];
    const usedIds = new Set<string>();

    for (const niche of niches) {
      const slots = Math.max(1, Math.round((niche.weight / totalWeight) * size));
      const candidates = await sql`
        SELECT * FROM customers
        WHERE niche_id = ${niche.id}
          AND (last_used_as_seed IS NULL OR last_used_as_seed < NOW() - INTERVAL '${cooldownDays} days')
        ORDER BY COALESCE(last_used_as_seed, '2000-01-01') ASC
        LIMIT ${slots}
      `;

      for (const c of candidates) {
        if (!usedIds.has(c.id) && picks.length < size) {
          picks.push(c);
          usedIds.add(c.id);
        }
      }
    }

    if (picks.length === 0) {
      return { data: null, message: 'No available seeds. All used within cooldown period.' };
    }

    // Build Apify-compatible JSON config
    const accounts = picks.map((c: any) => c.username);
    const limit = 500;
    const jsonConfig = {
      Account: accounts,
      username: accounts,
      usernames: accounts,
      directUrls: accounts.map((u: string) => `https://www.instagram.com/${u}/`),
      dataToScrape: 'Followers',
      searchType: 'followers',
      maxItems: limit,
      resultsLimit: limit,
      enrichProfile: true
    };

    // Save as pipeline run
    const [run] = await sql`
      INSERT INTO pipeline_runs (strategy, status, input_config)
      VALUES ('followers_seed', 'pending', ${JSON.stringify({
        seedCount: picks.length,
        nicheWeights: Object.fromEntries(niches.map((n: any) => [n.id, n.weight]))
      })})
      RETURNING id
    `;

    return {
      data: {
        id: run.id,
        picks: picks.map((c: any) => ({
          id: c.id,
          username: c.username,
          nicheId: c.niche_id
        })),
        nicheBreakdown: niches.reduce((acc: any, n: any) => {
          acc[n.id] = picks.filter((p: any) => p.niche_id === n.id).length;
          return acc;
        }, {}),
        jsonConfig: JSON.stringify(jsonConfig, null, 2),
        size: picks.length
      }
    };
  });

  // POST /api/batches/:runId/execute — Execute a batch (trigger Apify)
  app.post('/batches/:runId/execute', async (req) => {
    const { runId } = req.params as { runId: string };

    const [run] = await sql`SELECT * FROM pipeline_runs WHERE id = ${runId}`;
    if (!run) return { error: 'Pipeline run not found', code: 404 };

    await sql`
      UPDATE pipeline_runs SET status = 'running', started_at = NOW() WHERE id = ${runId}
    `;

    return {
      data: { runId, status: 'running', message: 'Batch dispatched to discovery worker' }
    };
  });

  // POST /api/batches/:runId/mark-used — Mark batch seeds as used
  app.post('/batches/:runId/mark-used', async (req) => {
    const { runId } = req.params as { runId: string };
    const { customerIds } = req.body as { customerIds: string[] };

    await sql`
      UPDATE customers
      SET last_used_as_seed = NOW(), updated_at = NOW()
      WHERE id = ANY(${customerIds}::uuid[])
    `;

    return { success: true, markedCount: customerIds.length };
  });
}
