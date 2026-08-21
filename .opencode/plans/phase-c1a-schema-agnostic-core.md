# Plan: Phase C1a — Schema-Agnostic Core

Approved direction: full multi-DB app (C1b follows), auth after (C2). This phase removes
sales-database assumptions from the runtime agent so any MySQL schema works.

## 1. New `tools/overview.tool.js` (replaces `tools/stats.tool.js`)
- name: `get_overview`, no parameters
- execute():
  a) Table list + exact row counts (COUNT(*) per table from INFORMATION_SCHEMA list)
  b) Date columns: INFORMATION_SCHEMA.COLUMNS where DATA_TYPE IN ('date','datetime','timestamp')
     and TABLE_SCHEMA = DATABASE(); then MIN/MAX per column grouped per table
- returns { tables: [{name, rowCount}], dateRanges: [{table, column, min, max}] }
- resilient: per-table errors degrade to skipped entries, never throw

## 2. Auto-injected Database Overview
- In runInvestigation: fetch overview (try/catch), render compact text block:
  "## Database Overview\nTables: orders (~1200 rows)\nTime ranges: orders.created_at: X -> Y"
- Injected as a system message right after the main system prompt
- Module-level cache, 5-minute TTL (keyed by DATABASE() name for C1b readiness)
- Failure to load overview logs a warning and continues without injection

## 3. Prompt neutralization (`agent/prompts.js`)
- Tool list becomes: get_schema, execute_sql, get_overview (generic descriptions)
- Strategy bullets rewritten entity-agnostic:
  - "Start broad" now refers to the injected overview instead of sales stat names
  - Heuristic 9: "...inspect related evidence in other tables: status fields
    (cancelled/refunded/failed patterns), reason/error columns, and whether affected
    entities changed state"
  - Heuristic 10 (per-group rates) stays as-is

## 4. Removals / renames
- Delete tools/stats.tool.js; agent.js registers overviewTool instead
- database/queries.js: check consumers (benchmark script?) - move to evaluation/ demo-only
  or delete if unused
- CACHED_TOOLS set: swap 'get_stats' -> 'get_overview'
- Test mocks in agent/endgame/performance reference statsTool('get_stats'): update to
  overviewTool('get_overview'); update scripted tool_calls using 'get_stats'
- prompts.test.js: rewrite domain assertions to match neutral wording

## 5. New tests
- tests/overview-tool.test.js: mocked query layer - row counts, date range detection,
  partial-failure resilience
- agent.test.js: overview injected as system message when available; absent when it fails
- prompts.test.js: neutral heuristic assertions

## 6. Docs
- README: tools table (get_overview replaces get_stats + 8 sales stats), structure tree,
  feature blurb "works on any MySQL schema"

## Verification
- npm test green (~328+)
- Commit 1: feat: schema-agnostic overview tool and neutral investigation prompt
