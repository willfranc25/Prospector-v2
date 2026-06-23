import { Job } from 'bullmq';
import { sql, redis } from '../index.js';
import { enrichmentQueue } from '../index.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const FOLLOWER_ACTOR_ID = 'scraping_solutions~instagram-scraper-followers-following-no-cookies';
const HASHTAG_ACTOR_ID = 'apify~instagram-hashtag-scraper';
const PROFILE_ACTOR_ID = 'dSCLg0C3YEZ83HzYX';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

interface DiscoveryJob {
  strategy: string;
  runId?: string;
  batchId?: string;
  seedIds?: string[];
  config?: Record<string, any>;
}

export async function discoveryWorker(job: Job<DiscoveryJob>) {
  const { strategy, runId, batchId, seedIds, config = {} } = job.data;

  console.log(`🔍 Discovery worker: strategy=${strategy} runId=${runId || 'auto'}`);

  // Use existing run or create new one
  let run: any;
  if (runId) {
    // Update the existing run created by the API
    await sql`UPDATE pipeline_runs SET status = 'running', started_at = NOW() WHERE id = ${runId}`;
    const [r] = await sql`SELECT * FROM pipeline_runs WHERE id = ${runId}`;
    run = r;
  } else {
    // Create a new run (for scheduler-triggered jobs)
    const [r] = await sql`
      INSERT INTO pipeline_runs (strategy, status, input_config)
      VALUES (${strategy}, 'running', ${JSON.stringify(job.data)})
      RETURNING id
    `;
    run = r;
  }

  try {
    let profiles: any[] = [];

    switch (strategy) {
      case 'followers_seed':
        profiles = await discoverFromFollowers(run.id, seedIds, config);
        break;
      case 'hashtag':
        profiles = await discoverFromHashtags(run.id, config);
        break;
      case 'semantic_search':
        profiles = await discoverSemantic(run.id, config);
        break;
      case 'competitor':
        profiles = await discoverFromCompetitors(run.id, config);
        break;
      default:
        // Generic discovery via Apify
        profiles = await genericDiscovery(run.id, strategy, config);
    }

    // Enqueue discovered profiles for enrichment
    if (profiles.length > 0) {
      await sql`
        UPDATE pipeline_runs
        SET stats = ${JSON.stringify({ discovered: profiles.length })}
        WHERE id = ${run.id}
      `;

      // Add to enrichment queue in batches
      for (let i = 0; i < profiles.length; i += 50) {
        const batch = profiles.slice(i, i + 50);
        await enrichmentQueue.add('enrich-batch', {
          profiles: batch,
          pipelineRunId: run.id,
          strategy
        }, { jobId: `enrich-${run.id}-${i}` });
      }

      await sql`
        UPDATE pipeline_runs SET status = 'completed', completed_at = NOW()
        WHERE id = ${run.id}
      `;
    } else {
      await sql`
        UPDATE pipeline_runs
        SET status = 'completed', stats = ${JSON.stringify({ discovered: 0, reason: 'no_results' })}, completed_at = NOW()
        WHERE id = ${run.id}
      `;
    }

    return { runId: run.id, discovered: profiles.length, strategy };
  } catch (err: any) {
    console.error(`❌ Discovery failed for run ${run.id}:`, err.message);
    await sql`
      UPDATE pipeline_runs
      SET status = 'failed', error_message = ${err.message}, completed_at = NOW()
      WHERE id = ${run.id}
    `;
    throw err;
  }
}

async function discoverFromFollowers(runId: string, seedIds?: string[], config?: Record<string, any>) {
  if (!seedIds?.length) {
    // Get recommended seeds from DB
    const seeds = await sql`
      SELECT c.username FROM customers c
      JOIN niches n ON c.niche_id = n.id
      WHERE (c.last_used_as_seed IS NULL OR c.last_used_as_seed < NOW() - INTERVAL '14 days')
      ORDER BY n.weight DESC
      LIMIT 14
    `;
    seedIds = seeds.map((s: any) => s.username);
  } else {
    // Get usernames for the given seed IDs
    const seeds = await sql`
      SELECT username FROM customers WHERE id = ANY(${seedIds}::uuid[])
    `;
    seedIds = seeds.map((s: any) => s.username);
  }

  if (!seedIds.length) {
    console.log('No seeds available for followers discovery');
    return [];
  }

  const limit = config?.resultsLimit || 500;

  console.log(`📱 Discovering followers for ${seedIds.length} seeds (limit: ${limit})`);

  // If APIFY_TOKEN is set, actually call Apify API
  if (APIFY_TOKEN) {
    try {
      const input = {
        Account: seedIds,
        username: seedIds,
        usernames: seedIds,
        directUrls: seedIds.map((u: string) => `https://www.instagram.com/${u}/`),
        dataToScrape: 'Followers',
        searchType: 'followers',
        maxItems: limit,
        resultsLimit: limit,
        enrichProfile: true
      };

      const res = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(FOLLOWER_ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      );

      if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
      const { data } = await res.json();
      const runData = data;

      // Poll for completion
      const items = await pollApifyRun(APIFY_TOKEN, runData.id, runData.defaultDatasetId, runId);

      // Mark seeds as used
      if (items.length > 0) {
        await sql`
          UPDATE customers
          SET last_used_as_seed = NOW(), updated_at = NOW()
          WHERE username = ANY(${seedIds})
        `;
      }

      return items;
    } catch (err) {
      console.error('Apify followers error:', err);
      return [];
    }
  }

  console.log('⚠️ No APIFY_TOKEN set — returning placeholder (0 profiles)');
  return [];
}

async function discoverFromHashtags(runId: string, config?: Record<string, any>) {
  const hashtags = config?.hashtags || [
    'medicaonline', 'drainstagram', 'nutricionistapersonal',
    'emprendedordigital', 'marcapersonalonline', 'coachdenegocios',
    'entrenadorpersonal', 'coachdebienestar', 'finanzaspersonales'
  ];

  if (APIFY_TOKEN) {
    try {
      const input = { hashtags, resultsLimit: config?.resultsLimit || 300 };
      const res = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(HASHTAG_ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      );
      if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
      const { data } = await res.json();
      return pollApifyRun(APIFY_TOKEN, data.id, data.defaultDatasetId, runId);
    } catch (err) {
      console.error('Apify hashtag error:', err);
      return [];
    }
  }

  return [];
}

async function discoverSemantic(runId: string, config?: Record<string, any>) {
  // Semantic search via ML service embeddings
  if (ML_SERVICE_URL) {
    try {
      const res = await fetch(`${ML_SERVICE_URL}/ml/similar/top-clients?limit=100`);
      if (res.ok) {
        const { data } = await res.json();
        return data || [];
      }
    } catch (err) {
      console.error('Semantic search error:', err);
    }
  }
  return [];
}

async function discoverFromCompetitors(runId: string, config?: Record<string, any>) {
  // Discover by scraping followers of known niche leaders
  const competitors = config?.competitors || [
    'doctorgram', 'medicinagram', 'emprendedoresexitosos',
    'marketinglatino', 'fitnesslatino', 'bellezalatina'
  ];

  if (APIFY_TOKEN) {
    try {
      const input = {
        Account: competitors,
        directUrls: competitors.map((u: string) => `https://www.instagram.com/${u}/`),
        dataToScrape: 'Followers',
        searchType: 'followers',
        maxItems: 500,
        resultsLimit: 500
      };

      const res = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(FOLLOWER_ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      );
      if (!res.ok) throw new Error(`Apify API error: ${res.status}`);
      const { data } = await res.json();
      return pollApifyRun(APIFY_TOKEN, data.id, data.defaultDatasetId, runId);
    } catch (err) {
      console.error('Competitor discovery error:', err);
      return [];
    }
  }

  return [];
}

async function genericDiscovery(runId: string, strategy: string, config?: Record<string, any>) {
  console.log(`Generic discovery for strategy: ${strategy}`);
  return [];
}

async function pollApifyRun(token: string, runId: string, datasetId: string, pipelineRunId: string, maxWaitMs = 480000): Promise<any[]> {
  const start = Date.now();
  const pollInterval = 10000;
  let attempt = 0;

  console.log(`⏳ Polling Apify run ${runId} (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - start < maxWaitMs) {
    attempt++;
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`, {
        signal: AbortSignal.timeout(15000)
      });

      if (!statusRes.ok) {
        console.warn(`⚠️ Poll #${attempt}: HTTP ${statusRes.status} (${elapsed}s)`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      const { data } = await statusRes.json();
      console.log(`📡 Poll #${attempt}: status=${data.status} (${elapsed}s elapsed)`);

      // Update pipeline run with progress
      try {
        await sql`
          UPDATE pipeline_runs
          SET stats = ${JSON.stringify({ progress: data.status, elapsed_seconds: elapsed, attempt })}
          WHERE id = ${pipelineRunId}
        `;
      } catch {}

      if (data.status === 'SUCCEEDED') {
        console.log(`✅ Apify run completed, fetching dataset ${datasetId}...`);
        const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`, {
          signal: AbortSignal.timeout(30000)
        });
        if (!itemsRes.ok) throw new Error(`Dataset fetch failed: ${itemsRes.status}`);
        const items = await itemsRes.json();
        console.log(`📦 Got ${items.length} items from Apify`);
        return items;
      }

      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(data.status)) {
        console.error(`❌ Apify run ended with status: ${data.status}`);
        throw new Error(`Apify run ${data.status}`);
      }
    } catch (err: any) {
      if (err.message?.includes('Apify run ')) throw err; // Re-throw terminal errors
      console.warn(`⚠️ Poll #${attempt} error: ${err.message} — retrying...`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.error(`⏰ Poll timed out after ${Math.round((Date.now() - start) / 1000)}s`);
  throw new Error('Apify run timed out');
}
