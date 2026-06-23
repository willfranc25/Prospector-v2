import { Job } from 'bullmq';
import { sql } from '../index.js';
import { scoringQueue } from '../index.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml:8000';

// ── Filter System ──
const SPANISH_WORDS = [' de ', ' que ', ' la ', ' el ', ' en ', ' y ', ' a ', ' los ', ' se ', ' del ', ' por ', ' con ', ' para ', ' una ', ' un '];
const TARGET_LOCATIONS = [
  'usa', 'estados unidos', 'miami', 'texas', 'california', 'florida', 'new york',
  'canada', 'toronto', 'españa', 'spain', 'madrid', 'barcelona', 'valencia',
  'europa', 'mexico', 'méxico', 'cdmx', 'monterrey', 'guadalajara',
  'colombia', 'bogota', 'medellin', 'argentina', 'buenos aires', 'chile', 'santiago',
  'peru', 'lima', 'venezuela', 'caracas', 'ecuador', 'quito', 'guayaquil',
  'panama', 'costa rica', 'uruguay', 'paraguay'
];
const DISCARD_KEYWORDS = [
  'agencia de marketing', 'agencia digital', 'social media agency', 'growth agency',
  'agencia creativa', 'marketing agency', 'memes', 'shitpost', 'noticias',
  '13 años', '14 años', '15 años', '16 años', '17 años', 'estudiante de secundaria',
  'vendo cuentas', 'compro cuentas', 'onlyfans', 'only fans'
];

function filterProfile(profile: any): string | null {
  const username = (profile.username || '').toLowerCase();
  if (!username) return 'sin_username';
  if (profile.isPrivate || profile.private) return 'cuenta_privada';
  const followers = Number(profile.followersCount) || Number(profile.followers) || 0;
  if (followers < 3000) return 'pocos_seguidores';
  if (followers > 200000) return 'muchos_seguidores';
  const bio = (profile.bio || profile.biography || '').trim();
  if (!bio) return 'sin_bio';
  const posts = Number(profile.postsCount) || Number(profile.posts) || 0;
  if (posts < 9) return 'pocos_posts';
  const bioLower = bio.toLowerCase();
  for (const kw of DISCARD_KEYWORDS) {
    if (bioLower.includes(kw)) return 'contenido_no_apto';
  }
  let hasSpanish = false;
  for (const word of SPANISH_WORDS) {
    if (bioLower.includes(word)) { hasSpanish = true; break; }
  }
  if (!hasSpanish) return 'no_hispanohablante';
  let hasTargetLocation = false;
  for (const loc of TARGET_LOCATIONS) {
    if (bioLower.includes(loc)) { hasTargetLocation = true; break; }
  }
  if (!hasTargetLocation) return 'ubicacion_no_deseada';
  return null;
}

interface EnrichmentJob {
  profiles: any[];
  pipelineRunId: string;
  strategy: string;
}

export async function enrichmentWorker(job: Job<EnrichmentJob>) {
  const { profiles, pipelineRunId, strategy } = job.data;
  console.log(`📝 Enrichment: ${profiles.length} profiles from run ${pipelineRunId}`);

  const stats = {
    enriched: 0, skipped: 0, errors: 0, filtered: 0, embeddingsGenerated: 0,
    filterReasons: {} as Record<string, number>
  };
  const enrichedIds: string[] = [];

  for (const profile of profiles) {
    try {
      const username = (profile.username || '').toLowerCase().trim();
      if (!username) { stats.skipped++; continue; }

      const [existing] = await sql`SELECT id FROM profiles WHERE username = ${username}`;
      if (existing) { stats.skipped++; continue; }

      // ── APPLY FILTERS ──
      const filterReason = filterProfile(profile);
      if (filterReason) {
        stats.filtered++;
        stats.filterReasons[filterReason] = (stats.filterReasons[filterReason] || 0) + 1;
        continue;
      }

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

      if (enrichedData.followers > 0 && enrichedData.latest_posts?.length > 0) {
        const totalLikes = enrichedData.latest_posts.reduce((sum: number, p: any) => sum + (p.likesCount || 0), 0);
        enrichedData.avg_likes = totalLikes / enrichedData.latest_posts.length;
        enrichedData.engagement_rate = enrichedData.avg_likes / enrichedData.followers;
      }

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

  console.log(`📊 Enrichment done: ${stats.enriched} inserted, ${stats.filtered} filtered, ${stats.errors} errors`);
  if (Object.keys(stats.filterReasons).length > 0) {
    console.log(`🚫 Filter breakdown: ${JSON.stringify(stats.filterReasons)}`);
  }

  // Generate embeddings via ML
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
      }
    } catch (err: any) {
      console.warn(`⚠️ ML service unavailable for embeddings: ${err.message}`);
    }

    await scoringQueue.add('score-ml', {
      pipelineRunId,
      profileIds: enrichedIds,
      useML: true
    }, { jobId: `score-ml-${pipelineRunId}` });
  }

  // Update pipeline run stats
  await sql`
    UPDATE pipeline_runs
    SET stats = stats || ${JSON.stringify({
      enriched: stats.enriched,
      filtered: stats.filtered,
      filterReasons: stats.filterReasons
    })}::jsonb
    WHERE id = ${pipelineRunId}
  `;

  return { pipelineRunId, ...stats };
}
