import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis: IORedis | null = null;
let discoveryQueue: Queue | null = null;

export function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    redis.connect().catch(() => {
      console.warn('⚠️ Redis not available — strategy execution will be DB-only');
    });
  }
  return redis;
}

export function getDiscoveryQueue(): Queue {
  if (!discoveryQueue) {
    discoveryQueue = new Queue('discovery', { connection: getRedis() });
  }
  return discoveryQueue;
}

export async function enqueueDiscoveryJob(strategy: string, runId: string, config?: Record<string, any>) {
  try {
    const queue = getDiscoveryQueue();
    const job = await queue.add(`discovery-${strategy}`, {
      strategy,
      runId,
      config
    }, {
      jobId: `discovery-${strategy}-${Date.now()}`,
      priority: 5,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 }
    });
    console.log(`📤 Enqueued discovery job: ${job.id} (strategy: ${strategy}, run: ${runId})`);
    return job;
  } catch (err: any) {
    console.warn(`⚠️ Could not enqueue discovery job: ${err.message}`);
    return null;
  }
}

export async function enqueueScoringJob(profileIds: string[]) {
  try {
    const queue = new Queue('scoring', { connection: getRedis() });
    await queue.add('score-stuck', {
      profileIds,
      useML: true
    }, { jobId: `score-stuck-${Date.now()}` });
    console.log(`📤 Enqueued scoring for ${profileIds.length} profiles`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ Could not enqueue scoring: ${err.message}`);
    return false;
  }
}
