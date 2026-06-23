import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';
import { z } from 'zod';

const FeedbackSchema = z.object({
  action: z.enum(['aprobado', 'descartado', 'contactado', 'cliente', 'favorito']),
  signals: z.array(z.string()).optional(),
  reviewerNotes: z.string().optional()
});

const ProfileQuerySchema = z.object({
  status: z.string().default('nuevo'),
  niche: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['score', 'followers', 'date', 'username']).default('score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  search: z.string().optional()
});

export async function profileRoutes(app: FastifyInstance) {
  // GET /api/profiles — List profiles with filtering & pagination
  app.get('/profiles', async (req, reply) => {
    const q = ProfileQuerySchema.parse(req.query);

    const conditions: string[] = [];
    const params: any[] = [];

    if (q.status) {
      conditions.push(`p.status = $${params.length + 1}`);
      params.push(q.status);
    }
    if (q.niche) {
      conditions.push(`p.niche_id = $${params.length + 1}`);
      params.push(q.niche);
    }
    if (q.minScore) {
      conditions.push(`p.score >= $${params.length + 1}`);
      params.push(q.minScore);
    }
    if (q.search) {
      conditions.push(`(p.username ILIKE $${params.length + 1} OR p.bio ILIKE $${params.length + 2} OR p.full_name ILIKE $${params.length + 3})`);
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (q.page - 1) * q.limit;

    const [profiles, totalResult] = await Promise.all([
      sql.unsafe(
        `SELECT p.*, n.label as niche_label, n.weight as niche_weight
         FROM profiles p
         LEFT JOIN niches n ON p.niche_id = n.id
         ${where}
         ORDER BY p.${q.sort} ${q.order}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.limit, offset]
      ),
      sql.unsafe(
        `SELECT COUNT(*) as total FROM profiles p ${where}`,
        params
      )
    ]);

    const total = Number(totalResult[0]?.total || 0);

    return {
      data: profiles,
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.ceil(total / q.limit),
        hasMore: offset + q.limit < total
      }
    };
  });

  // GET /api/profiles/:id
  app.get('/profiles/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [profile] = await sql`
      SELECT p.*, n.label as niche_label, n.weight as niche_weight
      FROM profiles p
      LEFT JOIN niches n ON p.niche_id = n.id
      WHERE p.id = ${id}
    `;
    if (!profile) {
      return { error: 'Profile not found', code: 404 };
    }
    return { data: profile };
  });

  // GET /api/profiles/next — Get next profile for review (swipe UI)
  app.get('/profiles/next', async (req) => {
    const { niche } = req.query as { niche?: string };

    const conditions = [`p.status = 'nuevo'`];
    if (niche) conditions.push(`p.niche_id = '${niche}'`);

    const [profile] = await sql.unsafe(`
      SELECT p.*, n.label as niche_label, n.weight as niche_weight
      FROM profiles p
      LEFT JOIN niches n ON p.niche_id = n.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.score DESC
      LIMIT 1
    `);

    if (!profile) {
      return { data: null, message: 'No profiles to review' };
    }
    return { data: profile };
  });

  // POST /api/profiles/:id/feedback — Record human feedback
  app.post('/profiles/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = FeedbackSchema.parse(req.body);

    // Update profile status
    await sql`
      UPDATE profiles
      SET status = ${body.action},
          manual_signals = ${body.signals || []},
          reviewer_notes = ${body.reviewerNotes || ''},
          review_date = NOW(),
          status_date = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = ${id}
    `;

    // Log feedback
    await sql`
      INSERT INTO feedback_log (profile_id, action, signals)
      VALUES (${id}, ${body.action}, ${body.signals || []})
    `;

    // Update daily stats
    const statField = body.action === 'cliente' ? 'cliente' :
                      body.action === 'contactado' ? 'contactado' :
                      body.action === 'aprobado' ? 'aprobado' : 'descartado';

    await sql.unsafe(`
      INSERT INTO daily_stats (date, ${statField})
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET ${statField} = daily_stats.${statField} + 1
    `);

    // Check if we should trigger ML retraining
    const { count } = await sql`
      SELECT COUNT(*)::int as count FROM feedback_log
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `;
    const [settings] = await sql`SELECT value FROM settings WHERE key = 'ml'`;
    const minSamples = settings?.value?.minSamplesForRetrain || 50;

    return {
      success: true,
      action: body.action,
      shouldRetrain: Number(count) >= minSamples
    };
  });

  // PUT /api/profiles/:id/signals — Toggle manual signals
  app.put('/profiles/:id/signals', async (req) => {
    const { id } = req.params as { id: string };
    const { signal } = req.body as { signal: string };

    const [profile] = await sql`SELECT manual_signals FROM profiles WHERE id = ${id}`;
    if (!profile) return { error: 'Profile not found', code: 404 };

    const signals: string[] = profile.manual_signals || [];
    const idx = signals.indexOf(signal);
    if (idx > -1) signals.splice(idx, 1);
    else signals.push(signal);

    await sql`UPDATE profiles SET manual_signals = ${signals}, updated_at = NOW() WHERE id = ${id}`;

    return { success: true, signals };
  });

  // GET /api/profiles/stats/queue — Queue stats
  app.get('/profiles/stats/queue', async () => {
    const rows = await sql`
      SELECT status, COUNT(*)::int as count
      FROM profiles
      GROUP BY status
    `;

    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.status] = r.count;

    return {
      data: {
        discovered: stats.discovered || 0,
        nuevo: stats.nuevo || 0,
        aprobado: (stats.aprobado || 0) + (stats.contactado || 0) + (stats.cliente || 0),
        descartado: stats.descartado || 0,
        contactado: stats.contactado || 0,
        cliente: stats.cliente || 0,
        total: Object.values(stats).reduce((a, b) => a + b, 0)
      }
    };
  });
}
