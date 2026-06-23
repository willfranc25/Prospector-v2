import { FastifyInstance } from 'fastify';
import { sql } from '../db/connection.js';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings
  app.get('/settings', async () => {
    const rows = await sql`SELECT key, value FROM settings`;
    const settings: Record<string, any> = {};
    for (const r of rows) settings[r.key] = r.value;
    return { data: settings };
  });

  // GET /api/settings/:key
  app.get('/settings/:key', async (req) => {
    const { key } = req.params as { key: string };
    const [row] = await sql`SELECT * FROM settings WHERE key = ${key}`;
    if (!row) return { error: 'Setting not found', code: 404 };
    return { data: row.value };
  });

  // PUT /api/settings/:key
  app.put('/settings/:key', async (req) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: any };

    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}, updated_at = NOW()
    `;

    return { success: true, key, value };
  });

  // GET /api/settings/filters
  app.get('/settings/filters', async () => {
    const [row] = await sql`SELECT value FROM settings WHERE key = 'filters'`;
    return { data: row?.value || {
      minFollowers: 3000, maxFollowers: 200000, minPosts: 9,
      filterPrivate: true, filterNoBio: true,
      requireSpanish: true, requireTargetLocation: true
    }};
  });

  // PUT /api/settings/filters
  app.put('/settings/filters', async (req) => {
    const filters = req.body as any;
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('filters', ${JSON.stringify(filters)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(filters)}, updated_at = NOW()
    `;
    return { success: true, filters };
  });
}
