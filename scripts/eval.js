import { runInvestigation } from '../agent/agent.js';
import { runScenario } from '../evaluation/runner.js';
import russianOrderDecline from '../evaluation/scenarios/russian-order-decline.js';
import mobilePaymentFailures from '../evaluation/scenarios/mobile-payment-failures.js';
import enterpriseBulkCancellation from '../evaluation/scenarios/enterprise-bulk-cancellation.js';
import { closePool } from '../database/mysql.js';

const scenarios = [
  russianOrderDecline,
  mobilePaymentFailures,
  enterpriseBulkCancellation,
];

async function main() {
  console.log('=== TraceIQ Evaluation Framework ===\n');

  const results = [];

  for (const scenario of scenarios) {
    console.log(`--- Scenario: ${scenario.name} ---`);
    console.log(`Question: ${scenario.question}\n`);

    try {
      const result = await runScenario(scenario, runInvestigation);
      results.push(result);

      console.log(`Status: ${result.passed === result.total ? 'PASS' : 'PARTIAL'}`);
      console.log(`Checks: ${result.passed}/${result.total} passed\n`);

      if (result.failed > 0) {
        console.log('Failed checks:');
        result.checks
          .filter(c => !c.passed)
          .forEach(c => console.log(`  - ${c.label}`));
        console.log();
      }

      if (result.result.answer) {
        const preview = result.result.answer.substring(0, 300);
        console.log(`Answer preview: ${preview}...\n`);
      }

      console.log(`Investigation ID: ${result.result.investigationId}`);
      console.log(`Steps: ${result.result.steps}, SQL queries: ${result.result.sqlQueries}`);
      console.log(`Duration: ${result.result.duration}ms\n`);
    } catch (err) {
      console.error(`ERROR: ${err.message}\n`);
      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed: 0,
        failed: 1,
        total: 1,
        error: err.message,
      });
    }
  }

  console.log('=== Summary ===');
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalChecks = results.reduce((sum, r) => sum + r.total, 0);
  console.log(`Scenarios: ${results.length}`);
  console.log(`Total checks: ${totalPassed}/${totalChecks} passed`);
  if (totalFailed > 0) {
    console.log(`${totalFailed} checks failed`);
  }

  await closePool();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
