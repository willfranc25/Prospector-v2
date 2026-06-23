import { Job } from 'bullmq';
import { sql } from '../index.js';
import { discoveryQueue, enrichmentQueue, retrainQueue } from '../index.js';

interface SchedulerJob {
  type?: string; // 'daily' | 'weekly' | 'retrain'
}

export async function schedulerWorker(job: Job<SchedulerJob>) {
  const jobName = job.name || job.id || 'unknown';
  console.log(`📅 Scheduler triggered: ${jobName}`);

  if (jobName === 'retrain-check') {
    await handleRetrainCheck();
    return { type: 'retrain_check' };
  }

  // Get enabled strategies, ordered by priority
  const strategies = await sql`
    SELECT * FROM discovery_strategies
    WHERE enabled = true
    ORDER BY priority DESC
  `;

  const isWeekly = jobName === 'weekly-discovery';

  for (const strategy of strategies) {
    const schedule = strategy.schedule;

    // Only run strategies matching the current schedule type
    if (isWeekly && schedule !== 'weekly') continue;
    if (!isWeekly && schedule !== 'daily') continue;

    // Enqueue discovery job
    await discoveryQueue.add(`discovery-${strategy.id}`, {
      strategy: strategy.id,
      config: strategy.config
    }, {
      jobId: `discovery-${strategy.id}-${Date.now()}`,
      priority: strategy.priority
    });

    console.log(`  ↳ Enqueued: ${strategy.name} (${strategy.id})`);
  }

  return {
    type: isWeekly ? 'weekly' : 'daily',
    strategiesTriggered: strategies.filter(s =>
      isWeekly ? s.schedule === 'weekly' : s.schedule === 'daily'
    ).map(s => s.id)
  };
}

async function handleRetrainCheck() {
  const [count] = await sql`
    SELECT COUNT(*)::int as count
    FROM feedback_log
    WHERE created_at > NOW() - INTERVAL '6 hours'
  `;

  const [settings] = await sql`SELECT value FROM settings WHERE key = 'ml'`;
  const minSamples = settings?.value?.minSamplesForRetrain || 50;

  console.log(`🧠 Retrain check: ${count.count} new labels (threshold: ${minSamples})`);

  if (Number(count.count) >= minSamples) {
    await retrainQueue.add('retrain', {
      labelsAvailable: Number(count.count),
      reason: `threshold_reached_${minSamples}`
    }, { jobId: `retrain-${Date.now()}` });

    console.log('  ↳ Retrain job enqueued');
  }
}
