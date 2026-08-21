# Plan: Phase A — Quality Loops

User approved. Goal: close agent-quality gaps and complete eval coverage of all 5 seed anomalies.

## A1. Investigation heuristics — `agent/prompts.js`

Add two bullets to "Investigation Strategy":

1. Dig past the symptom:
   "When orders or activity stop or decline sharply for a specific country, segment,
   device group, or product, do not stop at describing the drop. Before concluding,
   inspect adjacent evidence: payments (status, failure_reason) around the cutoff date,
   order statuses (cancelled/refunded), and whether the affected entities changed state."
2. Per-group rate computation:
   "When comparing failure or decline rates across groups, compute each group's rate
   separately as failed divided by total within that group over the same time window.
   Never report a blended all-groups average as one group's rate."

No ground-truth leakage: both are generic investigative strategy.

## A2. New scenarios (grounded in verifiable data only)

### `evaluation/scenarios/deactivated-product-surge.js`
- question: 'Are there any products we stopped selling recently? What happened to their sales?'
- groundTruth: Product 9 'Legacy Adapter' (hardware) has active=0. Return surge is
  narrative-only in seed comments; scenario asserts only discoverable facts.
- acceptableFindings:
  - ['legacy', 'adapter', 'product 9']
  - ['inactive', 'deactivated', 'not active', 'discontinued', 'no longer active']
  - ['sales', 'orders', 'revenue', 'sold']
- requiredKeywords: ['legacy|adapter']
- minSqlQueries: 1, minSteps: 2

### `evaluation/scenarios/usa-mobile-checkout-drop.js`
- question: 'Did orders from mobile users in the USA change recently compared to earlier?'
- groundTruth: README anomaly 5 narrative (failed A/B test); observable fact = recent
  USA consumer-mobile order volume decline vs earlier window.
- acceptableFindings:
  - ['usa', 'united states']
  - ['mobile']
  - ['drop', 'dropped', 'decline', 'declined', 'decrease', 'decreased', 'fewer', 'lower', 'down']
- requiredKeywords: ['mobile']
- minSqlQueries: 1, minSteps: 2

Note: existing scenario-definition tests do NOT assert a fixed count — safe to add.
seed.test.js confirms anomaly 3's verifiable fact is `active = 0` on products.

## A3. Wiring + tests + docs

1. `scripts/eval.js`: import both scenarios, add to `allScenarios` (default run + --only).
2. `tests/evaluation.test.js`: import both; add two "should have required fields" tests
   mirroring the existing three.
3. New `tests/prompts.test.js` (~3 tests):
   - buildSystemPrompt() contains payments/failure_reason guidance keywords
   - contains per-group rate computation guidance keywords
   - mentions cancelled/refunded state inspection
4. `README.md`:
   - "Available scenario IDs" line: add deactivated-product-surge, usa-mobile-checkout-drop
   - Scenario count text 3 → 5 where mentioned
   - Test table: add prompts.test.js row; bump evaluation.test.js count (+2)

## A4. Verification & commit

- npm test full suite green (expect ~321)
- Commit: `feat: investigation depth heuristics and full anomaly eval coverage`
- Live validation (user-run, TPD permitting):
  - `npm run eval -- --only=russian-order-decline,mobile-payment-failures` → expect ~19–20/20
  - New scenarios individually in later sessions (30–60k tokens each)
