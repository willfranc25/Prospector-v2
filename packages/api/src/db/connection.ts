import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const DB_URL = process.env.DATABASE_URL || 'postgresql://hermes:hermes_secret@localhost:5432/hermes';

const client = postgres(DB_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false
});

export const db = drizzle(client);

export async function checkConnection() {
  try {
    await client`SELECT 1`;
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    throw err;
  }
}

export { client as sql };
