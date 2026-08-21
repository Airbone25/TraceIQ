import { runInvestigation } from '../agent/agent.js';
import { runScenario } from '../evaluation/runner.js';
import russianOrderDecline from '../evaluation/scenarios/russian-order-decline.js';
import mobilePaymentFailures from '../evaluation/scenarios/mobile-payment-failures.js';
import enterpriseBulkCancellation from '../evaluation/scenarios/enterprise-bulk-cancellation.js';
import deactivatedProductSurge from '../evaluation/scenarios/deactivated-product-surge.js';
import usaMobileCheckoutDrop from '../evaluation/scenarios/usa-mobile-checkout-drop.js';
import { closePool } from '../database/mysql.js';

const allScenarios = [
  russianOrderDecline,
  mobilePaymentFailures,
  enterpriseBulkCancellation,
  deactivatedProductSurge,
  usaMobileCheckoutDrop,
];

function parseScenarioFilter(argv) {
  const onlyArg = argv.find(a => a.startsWith('--only='));
  if (!onlyArg) return null;
  return onlyArg
    .split('=')[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function main() {
  const onlyIds = parseScenarioFilter(process.argv.slice(2));
  let scenarios = allScenarios;
  if (onlyIds) {
    scenarios = allScenarios.filter(s => onlyIds.includes(s.id));
    if (scenarios.length === 0) {
      console.error(`No scenarios match filter: --only=${onlyIds.join(',')}`);
      console.error(`Available scenarios: ${allScenarios.map(s => s.id).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('=== TraceIQ Evaluation Framework ===\n');
  if (onlyIds) {
    console.log(`Filtered to scenarios: ${scenarios.map(s => s.id).join(', ')}\n`);
  }

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
