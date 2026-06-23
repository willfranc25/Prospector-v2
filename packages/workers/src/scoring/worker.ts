import { Job } from 'bullmq';
import { sql } from '../index.js';

interface ScoringJob {
  pipelineRunId?: string;
  profileIds?: string[];
  limit?: number;
}

export async function scoringWorker(job: Job<ScoringJob>) {
  const { pipelineRunId, profileIds, limit = 100 } = job.data;

  console.log(`🎯 Scoring: ${profileIds?.length || limit} profiles`);

  // Get profiles to score
  const profiles = profileIds?.length
    ? await sql`SELECT * FROM profiles WHERE id = ANY(${profileIds}::uuid[])`
    : pipelineRunId
      ? await sql`SELECT * FROM profiles WHERE discovery_batch_id = ${pipelineRunId} AND score = 0`
      : await sql`SELECT * FROM profiles WHERE score = 0 LIMIT ${limit}`;

  if (profiles.length === 0) {
    return { scored: 0, message: 'No profiles to score' };
  }

  // Get niches for classification
  const niches = await sql`SELECT * FROM niches`;

  const stats = {
    scored: 0,
    highPriority: 0,
    nicheBreakdown: {} as Record<string, number>
  };

  for (const profile of profiles) {
    const bio = (profile.bio || '').toLowerCase();
    let bestNiche: any = null;
    let bestHits = 0;

    // Multi-keyword niche classification
    for (const niche of niches) {
      if (niche.id === 'otro') continue;
      const keywords: string[] = niche.keywords || [];
      let hits = 0;

      for (const kw of keywords) {
        if (bio.includes(kw.toLowerCase())) hits++;
      }

      if (hits > 0 && (!bestNiche || hits * niche.weight > bestHits * (bestNiche?.weight || 0))) {
        bestNiche = niche;
        bestHits = hits;
      }
    }

    const niche = bestNiche || niches.find((n: any) => n.id === 'otro');

    // Multi-dimensional scoring
    let score = (niche?.weight || 25) * Math.min(1, 0.55 + bestHits * 0.15);

    // Followers window bonus (ideal: 3k-200k)
    const followers = profile.followers || 0;
    if (followers >= 3000 && followers <= 200000) score += 12;
    else if (followers > 200000) score -= 5; // Too big, less likely to need us
    else if (followers < 500) score -= 20;   // Too small

    // Activity signals
    const posts = profile.posts_count || 0;
    if (posts >= 9) score += 5;
    else score -= 5;

    // Professional signals
    if (profile.is_verified) score += 10;
    if (profile.external_url) score += 8;
    if (profile.is_business) score += 5;

    // Anti-signals (penalties)
    if (profile.is_private) score -= 40;

    // Manual signal bonuses (if already reviewed)
    const signals: string[] = profile.manual_signals || [];
    score += signals.length * 4;

    // Engagement quality
    if (profile.engagement_rate && profile.engagement_rate > 0.01) score += 5;
    if (profile.avg_likes && profile.avg_likes > 50) score += 3;

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));

    // Update in DB
    await sql`
      UPDATE profiles
      SET niche_id = ${niche.id},
          score = ${finalScore},
          score_details = ${JSON.stringify({
            base: niche.weight,
            keywordHits: bestHits,
            followersBonus: followers >= 3000 && followers <= 200000 ? 12 : -15,
            postBonus: posts >= 9 ? 5 : -5,
            verifiedBonus: profile.is_verified ? 10 : 0,
            urlBonus: profile.external_url ? 8 : 0,
            signalBonus: signals.length * 4,
            engagementBonus: (profile.engagement_rate && profile.engagement_rate > 0.01) ? 5 : 0,
            method: 'heuristic'
          })}::jsonb,
          status = CASE
            WHEN status = 'discovered' THEN 'nuevo'
            ELSE status
          END,
          updated_at = NOW()
      WHERE id = ${profile.id}
    `;

    stats.scored++;
    stats.nicheBreakdown[niche.id] = (stats.nicheBreakdown[niche.id] || 0) + 1;
    if (finalScore >= 70) stats.highPriority++;
  }

  // Update daily stats
  if (stats.scored > 0) {
    await sql.unsafe(`
      INSERT INTO daily_stats (date, discovered)
      VALUES (CURRENT_DATE, ${stats.scored})
      ON CONFLICT (date) DO UPDATE SET discovered = daily_stats.discovered + ${stats.scored}
    `);
  }

  return {
    ...stats,
    nicheBreakdown: stats.nicheBreakdown
  };
}
