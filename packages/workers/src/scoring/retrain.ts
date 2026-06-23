import { Job } from 'bullmq';
import { sql } from '../index.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml:8000';

interface RetrainJob {
  labelsAvailable?: number;
  reason?: string;
}

export async function retrainWorker(job: Job<RetrainJob>) {
  const { labelsAvailable = 0, reason = 'scheduled' } = job.data;
  console.log(`🧠 Retrain worker: ${labelsAvailable} labels available (reason: ${reason})`);

  try {
    // Verify we have enough labels
    const [count] = await sql`SELECT COUNT(*)::int as count FROM feedback_log`;

    if (Number(count.count) < 10) {
      console.log(`⚠️ Not enough labeled data (${count.count} < 10), skipping retrain`);
      return { status: 'skipped', reason: 'not_enough_labels', count: count.count };
    }

    // Call ML service to retrain
    const res = await fetch(`${ML_SERVICE_URL}/ml/retrain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: reason === 'manual' }),
      signal: AbortSignal.timeout(120000)
    });

    if (res.ok) {
      const result = await res.json();
      console.log(`✅ Model retrained: ${result.samples} samples, accuracy: ${result.accuracy_approx}`);
      return { status: 'completed', ...result };
    } else {
      const err = await res.text();
      console.warn(`⚠️ ML retrain failed: ${res.status} — ${err}`);
      return { status: 'failed', error: err };
    }
  } catch (err: any) {
    console.warn(`⚠️ ML service unavailable for retrain: ${err.message}`);
    return { status: 'failed', error: err.message };
  }
}
