import { Job } from 'bullmq';
import { sql } from '../index.js';
import { scoringQueue } from '../index.js';

const PROFILE_ACTOR_ID = 'dSCLg0C3YEZ83HzYX';
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml:8000';

interface EnrichmentJob {
  profiles: any[];
  pipelineRunId: string;
  strategy: string;
}

export async function enrichmentWorker(job: Job<EnrichmentJob>) {
  const { profiles, pipelineRunId, strategy } = job.data;

  console.log(`📝 Enrichment: ${profiles.length} profiles from run ${pipelineRunId}`);

  const stats = { enriched: 0, skipped: 0, errors: 0, embeddingsGenerated: 0 };
  const enrichedIds: string[] = [];

  for (const profile of profiles) {
    try {
      const username = (profile.username || '').toLowerCase().trim();
      if (!username) { stats.skipped++; continue; }

      const [existing] = await sql`SELECT id FROM profiles WHERE username = ${username}`;
      if (existing) { stats.skipped++; continue; }

      const enrichedData: any = {
        bio: profile.bio || profile.biography || '',
        followers: Number(profile.followersCount) || Number(profile.followers) || 0,
        following: Number(profile.followingCount) || Number(profile.following) || 0,
        posts_count: Number(profile.postsCount) || Number(profile.posts) || 0,
        is_private: !!(profile.isPrivate || profile.private),
        is_verified: !!(profile.isVerified || profile.verified),
        is_business: !!(profile.isBusinessAccount),
        external_url: profile.externalUrl || profile.website || '',
        full_name: profile.fullName || profile.full_name || profile.name || '',
        profile_pic_url: profile.profilePicUrl || '',
        category: profile.category || profile.businessCategory || '',
        engagement_rate: profile.engagementRate || null,
        avg_likes: profile.avgLikes || null,
        avg_comments: profile.avgComments || null,
        latest_posts: profile.latestPosts || [],
        posting_frequency: profile.postingFrequency || null
      };

      // Calculate derived metrics
      if (enrichedData.followers > 0 && enrichedData.latest_posts?.length > 0) {
        const totalLikes = enrichedData.latest_posts.reduce(
          (sum: number, p: any) => sum + (p.likesCount || 0), 0
        );
        enrichedData.avg_likes = totalLikes / enrichedData.latest_posts.length;
        enrichedData.engagement_rate = enrichedData.avg_likes / enrichedData.followers;
      }

      // Insert into DB
      const [inserted] = await sql`
        INSERT INTO profiles (
          username, bio, full_name, followers, following, posts_count,
          is_private, is_verified, is_business, external_url, profile_pic_url,
          category, engagement_rate, avg_likes, avg_comments,
          latest_posts, posting_frequency,
          discovery_source, discovery_batch_id, status
        ) VALUES (
          ${username}, ${enrichedData.bio}, ${enrichedData.full_name},
          ${enrichedData.followers}, ${enrichedData.following}, ${enrichedData.posts_count},
          ${enrichedData.is_private}, ${enrichedData.is_verified}, ${enrichedData.is_business},
          ${enrichedData.external_url}, ${enrichedData.profile_pic_url},
          ${enrichedData.category}, ${enrichedData.engagement_rate},
          ${enrichedData.avg_likes}, ${enrichedData.avg_comments},
          ${JSON.stringify(enrichedData.latest_posts)}, ${enrichedData.posting_frequency},
          ${strategy}, ${pipelineRunId}, 'discovered'
        )
        RETURNING id
      `;

      if (inserted) enrichedIds.push(inserted.id);
      stats.enriched++;
    } catch (err: any) {
      console.error(`Enrichment error for ${profile.username}:`, err.message);
      stats.errors++;
    }
  }

  // Generate embeddings for enriched profiles via ML service
  if (enrichedIds.length > 0) {
    try {
      const embRes = await fetch(`${ML_SERVICE_URL}/ml/embeddings/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_ids: enrichedIds })
      });

      if (embRes.ok) {
        const embData = await embRes.json();
        stats.embeddingsGenerated = embData.generated || enrichedIds.length;
        console.log(`🧠 Embeddings generated for ${stats.embeddingsGenerated} profiles`);
      } else {
        console.warn(`⚠️ ML service returned ${embRes.status} for embeddings`);
      }
    } catch (err: any) {
      console.warn(`⚠️ ML service unavailable for embeddings: ${err.message} — profiles stored without vectors`);
    }

    // Enqueue for scoring via ML
    await scoringQueue.add('score-ml', {
      pipelineRunId,
      profileIds: enrichedIds,
      useML: true
    }, { jobId: `score-ml-${pipelineRunId}` });
  }

  return { pipelineRunId, ...stats };
}
