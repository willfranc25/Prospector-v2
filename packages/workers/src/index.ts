import { Queue, Worker, QueueScheduler } from 'bullmq';
import Redis from 'ioredis';
import postgres from 'postgres';
import { discoveryWorker } from './discovery/worker.js';
import { enrichmentWorker } from './enrichment/worker.js';
import { scoringWorker } from './scoring/worker.js';
import { schedulerWorker } from './discovery/scheduler.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DB_URL = process.env.DATABASE_URL || 'postgresql://hermes:hermes_secret@localhost:5432/hermes';

export const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
export const sql = postgres(DB_URL);

// Queues
export const discoveryQueue = new Queue('discovery', { connection: redis });
export const enrichmentQueue = new Queue('enrichment', { connection: redis });
export const scoringQueue = new Queue('scoring', { connection: redis });
export const exportQueue = new Queue('export', { connection: redis });
export const retrainQueue = new Queue('retrain', { connection: redis });
export const schedulerQueue = new Queue('scheduler', { connection: redis });

// Workers
const workers: Worker[] = [];

async function start() {
  console.log('🚀 Hermes Workers starting...');

  // Discovery worker — handles Apify scraping jobs
  const discWorker = new Worker('discovery', discoveryWorker, {
    connection: redis,
    concurrency: 2,
    limiter: { max: 5, duration: 60000 } // max 5 discovery jobs per minute
  });
  workers.push(discWorker);

  // Enrichment worker — enriches profiles with additional data
  const enrichWorker = new Worker('enrichment', enrichmentWorker, {
    connection: redis,
    concurrency: 5
  });
  workers.push(enrichWorker);

  // Scoring worker — scores profiles using heuristics/ML
  const scoreWorker = new Worker('scoring', scoringWorker, {
    connection: redis,
    concurrency: 10
  });
  workers.push(scoreWorker);

  // Scheduler worker — triggers scheduled discovery strategies
  const schedWorker = new Worker('scheduler', schedulerWorker, {
    connection: redis
  });
  workers.push(schedWorker);

  // Set up recurring scheduler jobs
  await setupSchedules();

  console.log('✅ All workers started');

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      console.log(`\n${signal} received, shutting down workers...`);
      await Promise.all(workers.map(w => w.close()));
      await redis.quit();
      await sql.end();
      process.exit(0);
    });
  }
}

async function setupSchedules() {
  // Clean old repeatable jobs
  await schedulerQueue.obliterate({ force: true });

  // Daily discovery at 2 AM, 10 AM, 6 PM
  await schedulerQueue.add('daily-discovery', {}, {
    repeat: { pattern: '0 2,10,18 * * *' },
    jobId: 'daily-discovery'
  });

  // Weekly deep discovery (Sunday 3 AM)
  await schedulerQueue.add('weekly-discovery', {}, {
    repeat: { pattern: '0 3 * * 0' },
    jobId: 'weekly-discovery'
  });

  // Retraining check every 6 hours
  await schedulerQueue.add('retrain-check', {}, {
    repeat: { pattern: '0 */6 * * *' },
    jobId: 'retrain-check'
  });

  console.log('📅 Schedules configured: daily (02,10,18), weekly (Sun 03), retrain (every 6h)');
}

start();
