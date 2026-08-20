#!/usr/bin/env node

import { runInvestigation } from '../agent/agent.js';

const QUESTION = 'Why did our orders drop yesterday compared to the previous 7 days?';

async function main() {
  console.log(`Question: "${QUESTION}"\n`);

  const wallStart = Date.now();
  const result = await runInvestigation(QUESTION);
  const wallEnd = Date.now();
  const wallDuration = wallEnd - wallStart;

  const totalMs = result.totalDuration || wallDuration;
  const groqCalls = result.llmCalls || 0;
  const groqTotalMs = result.llmDuration || 0;
  const toolCalls = result.toolCalls?.length || 0;
  const sqlQueries = result.sqlQueries || 0;
  const sqlDurations = result.sqlDurations || [];
  const sqlTotalMs = sqlDurations.reduce((a, b) => a + b, 0);
  const overheadMs = result.overheadDuration || 0;
  const failedTools = result.failedToolCalls || 0;
  const otherMs = Math.max(0, totalMs - groqTotalMs - sqlTotalMs - overheadMs);

  const groqAvg = groqCalls > 0 ? groqTotalMs / groqCalls : 0;
  const groqSlowest = result.llmCallDetails?.length
    ? Math.max(...result.llmCallDetails.map(d => d.duration))
    : 0;

  const sqlAvg = sqlDurations.length > 0 ? sqlTotalMs / sqlDurations.length : 0;
  const sqlSlowest = sqlDurations.length > 0 ? Math.max(...sqlDurations) : 0;

  const fmtMs = (ms) => {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return ms + 'ms';
  };

  console.log(`Total: ${(totalMs / 1000).toFixed(1)}s\n`);

  console.log('Groq:');
  console.log(`  calls: ${groqCalls}`);
  console.log(`  total: ${(groqTotalMs / 1000).toFixed(1)}s`);
  console.log(`  avg: ${fmtMs(Math.round(groqAvg))}`);
  console.log(`  slowest: ${fmtMs(groqSlowest)}`);
  console.log('');

  if (result.llmCallDetails?.length) {
    console.log('  Individual calls:');
    for (const d of result.llmCallDetails) {
      const errTag = d.error ? ' [ERROR]' : '';
      console.log(`    #${d.callNumber}: ${fmtMs(d.duration)}  finish=${d.finishReason}  tools=${d.toolCallCount}  tokens=${d.promptTokens || '?'}+${d.completionTokens || '?'}${errTag}`);
    }
    console.log('');
  }

  console.log('Tools:');
  console.log(`  calls: ${toolCalls}`);
  console.log(`  failed: ${failedTools}`);
  console.log('');

  console.log('MySQL:');
  console.log(`  queries: ${sqlQueries}`);
  console.log(`  total: ${sqlTotalMs}ms`);
  if (sqlDurations.length) {
    console.log(`  avg: ${sqlAvg.toFixed(0)}ms`);
    console.log(`  slowest: ${sqlSlowest}ms`);
    console.log(`  individual: [${sqlDurations.join(', ')}]`);
  }
  console.log('');

  console.log('Other:');
  console.log(`  overhead (tool batch → next LLM): ${fmtMs(overheadMs)}`);
  console.log(`  remaining (construction, serialization, etc.): ${fmtMs(otherMs)}`);
  console.log(`  wall clock: ${fmtMs(wallDuration)}`);
  console.log('');

  const dominant = groqTotalMs >= sqlTotalMs && groqTotalMs >= overheadMs ? 'Groq API latency'
    : sqlTotalMs >= overheadMs ? 'MySQL execution'
    : 'Agent overhead/serialization';

  console.log(`Dominant bottleneck: ${dominant}`);
  console.log(`  Groq=${(groqTotalMs / totalMs * 100).toFixed(1)}%  MySQL=${(sqlTotalMs / totalMs * 100).toFixed(1)}%  Overhead=${(overheadMs / totalMs * 100).toFixed(1)}%  Other=${(otherMs / totalMs * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
