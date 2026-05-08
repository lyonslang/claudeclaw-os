#!/usr/bin/env node
/**
 * pipeline-cli.ts — God's Eye content pipeline CLI
 *
 * Usage:
 *   node dist/pipeline-cli.js analyze @ChannelHandle --niche comedy
 *   node dist/pipeline-cli.js script @ChannelHandle --niche comedy --mechanism NARRATIVE_VOID
 *   node dist/pipeline-cli.js score @ChannelHandle --title "Why Did This Go Viral?" --niche comedy
 *   node dist/pipeline-cli.js score @ChannelHandle --title "Star GOES OFF..." --hook "You won't believe" --niche comedy
 */

import { analyzeChannel, analyzeAndScript, scoreConceptForChannel } from '../src/pipeline.js';

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(`
God's Eye Pipeline CLI

Commands:
  analyze <channel>   Fetch + analyze a YouTube channel
  script <channel>    Analyze + generate a production-ready script
  score <channel>     Score a concept against a channel's patterns

Options:
  --niche <niche>           Content niche (default: general)
  --mechanism <type>        Insight mechanism: COUNTER_INTUITIVE_CAUSALITY | NARRATIVE_VOID | PERSPECTIVE_SHIFT
  --title <title>           Video title concept (for score command)
  --hook <hook>             Hook text (for score command)
  --format <format>         Format: short | long-form (for score command)
  --max <n>                 Max videos to fetch (default: 50)
  --force                   Force re-fetch even if data is fresh
  --json                    Output raw JSON only (no human summary)

Examples:
  node dist/pipeline-cli.js analyze @MrBeast --niche entertainment
  node dist/pipeline-cli.js script @SomeCreator --niche comedy --mechanism NARRATIVE_VOID
  node dist/pipeline-cli.js score @SomeCreator --title "Why Everyone Is Wrong About This?" --niche comedy
`);
    process.exit(0);
  }

  const channel = args[1];
  if (!channel) {
    console.error('Error: channel argument required (e.g. @ChannelHandle or UCxxxxxx)');
    process.exit(1);
  }

  const niche = getFlag('--niche') || 'general';
  const maxVideos = parseInt(getFlag('--max') || '50', 10);
  const force = hasFlag('--force');
  const jsonOnly = hasFlag('--json');

  try {
    if (command === 'analyze') {
      const result = await analyzeChannel(channel, niche, { maxVideos, force });

      if (jsonOnly) {
        console.log(JSON.stringify(result.brief, null, 2));
      } else {
        console.log('\n' + '='.repeat(60));
        console.log(`GOD'S EYE ANALYSIS: ${result.channel_name}`);
        console.log('='.repeat(60));
        console.log(`Niche: ${niche} | Videos: ${result.videos_analyzed} | Confidence: ${result.brief.confidence_level}`);
        console.log(`Data: ${result.from_cache ? 'cached (< 7 days old)' : 'freshly fetched'}`);
        console.log('-'.repeat(60));
        console.log(result.human_summary);
        console.log('-'.repeat(60));

        if (result.brief.top_patterns.length > 0) {
          console.log('\nTop Patterns:');
          for (const p of result.brief.top_patterns.slice(0, 5)) {
            console.log(`  ${Math.round(p.confidence * 100)}% | ${p.pattern} (${p.performance_delta})`);
          }
        }

        if (result.brief.competitor_gaps.length > 0) {
          console.log('\nGaps:');
          for (const g of result.brief.competitor_gaps.slice(0, 3)) {
            console.log(`  ${Math.round(g.confidence * 100)}% | ${g.gap}`);
          }
        }

        console.log('\n' + '='.repeat(60));
      }

    } else if (command === 'script') {
      const mechanism = (getFlag('--mechanism') || 'COUNTER_INTUITIVE_CAUSALITY') as any;
      const result = await analyzeAndScript(channel, niche, mechanism, { maxVideos, force });

      if (jsonOnly) {
        console.log(JSON.stringify({
          brief: result.analysis.brief,
          script: result.script,
          pre_production_score: result.pre_production_score,
        }, null, 2));
      } else {
        console.log('\n' + '='.repeat(60));
        console.log(`PIPELINE: ${result.analysis.channel_name} → Script`);
        console.log('='.repeat(60));
        console.log(`Pre-production score: ${result.pre_production_score.score}/100`);
        console.log(`${result.pre_production_score.summary}`);
        console.log(`Production ready: ${result.script.ready_for_production ? 'YES' : 'NO'}`);
        console.log(`Pivot: ${result.script.pivot_angle_used} | Mechanism: ${result.script.insight_mechanism}`);
        console.log('-'.repeat(60));
        console.log(`Hook: ${result.script.script.hook}`);
        console.log('-'.repeat(60));
        console.log(`Matched patterns: ${result.pre_production_score.matched_patterns.join(', ') || 'none'}`);
        console.log(`Missing: ${result.pre_production_score.missing_patterns.join(', ') || 'none'}`);
        console.log(`Arc alignment: ${result.pre_production_score.arc_alignment}`);
        console.log('='.repeat(60));
      }

    } else if (command === 'score') {
      const title = getFlag('--title');
      if (!title) {
        console.error('Error: --title required for score command');
        process.exit(1);
      }

      const hook = getFlag('--hook');
      const format = getFlag('--format');

      const result = await scoreConceptForChannel(channel, { title, hook, format }, niche);

      if (jsonOnly) {
        console.log(JSON.stringify(result.score, null, 2));
      } else {
        console.log('\n' + '='.repeat(60));
        console.log(`PRE-PRODUCTION SCORE: "${title}"`);
        console.log(`Channel: ${result.analysis.channel_name} (${niche})`);
        console.log('='.repeat(60));
        console.log(`Score: ${result.score.score}/100 (confidence-weighted: ${result.score.confidence_weighted_score}/100)`);
        console.log(`Arc alignment: ${result.score.arc_alignment}`);
        console.log(`${result.score.summary}`);
        console.log('-'.repeat(60));
        if (result.score.matched_patterns.length > 0) {
          console.log('Matched:');
          result.score.matched_patterns.forEach(p => console.log(`  + ${p}`));
        }
        if (result.score.missing_patterns.length > 0) {
          console.log('Missing:');
          result.score.missing_patterns.forEach(p => console.log(`  - ${p}`));
        }
        console.log('='.repeat(60));
      }

    } else {
      console.error(`Unknown command: ${command}. Use --help for usage.`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`Pipeline error: ${error.message}`);
    process.exit(1);
  }
}

main();
