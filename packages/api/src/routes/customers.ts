import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';
import { z } from 'zod';

const CustomerSchema = z.object({
  username: z.string().min(1).max(30).transform(s => s.replace(/^@/, '')),
  nicheId: z.string(),
  notes: z.string().optional()
});

export async function customerRoutes(app: FastifyInstance) {
  // GET /api/customers
  app.get('/customers', async (req) => {
    const { niche, search, page = '1', limit = '50' } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (niche) { conditions.push(`c.niche_id = $${idx++}`); params.push(niche); }
    if (search) { conditions.push(`c.username ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);

    const [customers, total] = await Promise.all([
      sql.unsafe(
        `SELECT c.*, n.label as niche_label
         FROM customers c
         LEFT JOIN niches n ON c.niche_id = n.id
         ${where}
         ORDER BY c.added_date DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, Number(limit), offset]
      ),
      sql.unsafe(`SELECT COUNT(*)::int as total FROM customers c ${where}`, params)
    ]);

    return { data: customers, total: total[0]?.total || 0 };
  });

  // POST /api/customers
  app.post('/customers', async (req) => {
    const { username, nicheId, notes } = CustomerSchema.parse(req.body);

    const [customer] = await sql`
      INSERT INTO customers (username, niche_id, notes)
      VALUES (${username}, ${nicheId}, ${notes || ''})
      ON CONFLICT (username) DO UPDATE SET niche_id = ${nicheId}, notes = ${notes || ''}, updated_at = NOW()
      RETURNING *
    `;

    return { data: customer };
  });

  // DELETE /api/customers/:id
  app.delete('/customers/:id', async (req) => {
    const { id } = req.params as { id: string };
    await sql`DELETE FROM customers WHERE id = ${id}`;
    return { success: true };
  });

  // GET /api/customers/available-seeds — Seeds ready for batch generation
  app.get('/customers/available-seeds', async (req) => {
    const cooldownDays = 14;
    const batchSize = 14;

    // Get niches sorted by weight
    const niches = await sql`
      SELECT * FROM niches WHERE id != 'otro' ORDER BY weight DESC
    `;

    const totalWeight = niches.reduce((sum: number, n: any) => sum + n.weight, 0);

    const seeds: any[] = [];
    const usedIds = new Set<string>();

    for (const niche of niches) {
      const slots = Math.max(1, Math.round((niche.weight / totalWeight) * batchSize));
      const candidates = await sql`
        SELECT * FROM customers
        WHERE niche_id = ${niche.id}
          AND (last_used_as_seed IS NULL OR last_used_as_seed < NOW() - INTERVAL '${cooldownDays} days')
          AND id NOT IN (SELECT unnest(${Array.from(usedIds)}::uuid[]))
        ORDER BY COALESCE(last_used_as_seed, '2000-01-01') ASC
        LIMIT ${slots}
      `;

      for (const c of candidates) {
        if (!usedIds.has(c.id)) {
          seeds.push(c);
          usedIds.add(c.id);
        }
      }
    }

    return {
      data: seeds.slice(0, batchSize),
      config: {
        totalAvailable: seeds.length,
        batchSize,
        cooldownDays,
        nicheWeights: Object.fromEntries(niches.map((n: any) => [n.id, n.weight]))
      }
    };
  });
}
