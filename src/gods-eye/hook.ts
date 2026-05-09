/**
 * Gods Eye — Hook Analysis
 * Scores hook quality: pattern interrupt, curiosity gap, social proof.
 */

import type { YouTubeVideo, HookAnalysis } from './types.js';

export function analyzeHook(videos: YouTubeVideo[], niche: string): HookAnalysis {
  // Analyze opening hooks from top-performing videos
  const topVideos = videos.slice(0, 3);

  // Detect pattern interrupt (opening with unexpected statement)
  const hasPatternInterrupt = topVideos.some(v => {
    const title = v.title || '';
    return title.includes('Wait') || title.includes('Actually') ||
           title.includes('But') || title.includes('I just');
  });

  // Detect curiosity gap (question or incomplete promise)
  const hasCuriosityGap = topVideos.some(v => {
    const title = v.title || '';
    return title.includes('?') || title.includes('Here\'s why') ||
           title.includes('You won\'t believe');
  });

  // Detect social proof (names, numbers, credentials)
  const hasSocialProof = topVideos.some(v => {
    const title = v.title || '';
    return /[A-Z][a-z]+ [A-Z][a-z]+/.test(title) || // Names
           /\d+[MKB%]/.test(title) || // Numbers/percentages
           title.includes('Expert') || title.includes('Scientist');
  });

  // Average engagement of top 3 videos
  const topEngagement = topVideos.reduce((sum, v) => sum + v.engagement_rate, 0) / topVideos.length;
  const avgEngagement = videos.reduce((sum, v) => sum + v.engagement_rate, 0) / videos.length;

  // Calculate hook score (0-10)
  const score = Math.min(
    10,
    (hasPatternInterrupt ? 3 : 0) +
    (hasCuriosityGap ? 3 : 0) +
    (hasSocialProof ? 2 : 0) +
    (topEngagement > avgEngagement * 1.5 ? 2 : 0)
  );

  return {
    score: parseFloat(score.toFixed(1)),
    psychology: [
      hasPatternInterrupt ? 'Pattern interrupt' : null,
      hasCuriosityGap ? 'Curiosity gap' : null,
      hasSocialProof ? 'Social proof' : null,
    ].filter(Boolean).join(' + '),
    pattern_interrupt: hasPatternInterrupt,
    curiosity_gap: hasCuriosityGap,
    social_proof: hasSocialProof,
    time_to_reveal_promise: topEngagement > avgEngagement ? 3 : 5,
    strengths: [
      hasPatternInterrupt && 'Pattern interrupt in opening',
      hasCuriosityGap && 'Creates curiosity gap',
      hasSocialProof && 'Includes social proof (names/numbers)',
      topEngagement > avgEngagement && `Top videos show ${(topEngagement / avgEngagement).toFixed(1)}x higher engagement`,
    ].filter(Boolean) as string[],
    weaknesses: [
      !hasPatternInterrupt && 'Missing pattern interrupt (try opening with unexpected statement)',
      !hasCuriosityGap && 'Could create stronger curiosity gap',
      score < 7 && 'Hook score below 7 \u2014 consider combining multiple psychological triggers',
    ].filter(Boolean) as string[],
    recommended_hook: topVideos[0]?.title || 'Analyze your top-performing video title as template',
    hook_template: hasCuriosityGap ? 'mystery_promise' : 'curiosity_gap',
  };
}