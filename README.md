<div align="center">

# TraceIQ

### AI Database Investigation Agent

An autonomous agent that investigates business questions by exploring a MySQL database, forming hypotheses, running SQL queries, and delivering evidence-backed conclusions.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-227%20passing-brightgreen)](#testing)

</div>

---

## What Is This?

TraceIQ is a production-grade AI agent that answers business questions by autonomously investigating a MySQL database. It is **not** a chatbot or a simple text-to-SQL wrapper. It is an agentic system that thinks, plans, executes, observes, and iterates.

**Example question:**
> "Why did our orders drop yesterday compared to the previous 7 days?"

**What TraceIQ does:**

1. Inspects the database schema to understand available data
2. Forms a hypothesis about the root cause
3. Generates and executes targeted read-only SQL queries
4. Analyzes the returned data
5. Decides whether additional investigation is needed
6. Performs follow-up queries when necessary
7. Produces a structured, evidence-backed conclusion
8. Persists every step for auditing and debugging

## Architecture

The core design enforces a strict separation of concerns: the LLM never directly touches the database.

```
┌─────────────────────────────────────────────────────────┐
│                      User Request                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    Agent Runtime                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  LLM (Groq API)                                  │    │
│  │  Receives context, produces tool calls or answer  │    │
│  └────────────────────────┬────────────────────────┘    │
│                           │                              │
│  ┌────────────────────────▼────────────────────────┐    │
│  │  Tool Registry                                  │    │
│  │  Routes tool calls to registered handlers        │    │
│  └────────────────────────┬────────────────────────┘    │
│                           │                              │
│  ┌────────────────────────▼────────────────────────┐    │
│  │  Security / Validation Layer                     │    │
│  │  SQL validator, row limits, read-only enforcement │    │
│  └────────────────────────┬────────────────────────┘    │
│                           │                              │
│  ┌────────────────────────▼────────────────────────┐    │
│  │  Bounded State                                  │    │
│  │  MAX_AGENT_STEPS=8, MAX_SQL_QUERIES=5,           │    │
│  │  MAX_EXECUTION_TIME_MS=60000                     │    │
│  └─────────────────────────────────────────────────┘    │
│                           │                              │
│  ┌────────────────────────▼────────────────────────┐    │
│  │  Investigation Persistence                      │    │
│  │  MySQL audit log of all investigations           │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    MySQL                                 │
│  Data: customers · orders · order_items · products       │
│  Audit: investigations · investigation_steps             │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Autonomous investigation loop** — LLM decides when to query, when to dig deeper, and when to conclude
- **SQL security** — blocks all write operations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE), injection patterns, and multi-statement attacks
- **Bounded autonomy** — configurable hard limits on steps, queries, rows, and execution time that the LLM cannot override
- **Full audit trail** — every investigation and tool call persisted to MySQL with unique IDs
- **Pre-built analytics** — summary statistics for quick overviews before deep-dive queries
- **Deterministic seed data** — realistic business dataset with intentional anomalies for agent evaluation
- **Evaluation framework** — deterministic scenarios for measuring agent performance against known anomalies
- **Structured logging** — Pino-based JSON logging across all layers
- **LLM retry with backoff** — automatic retry on transient API errors (429, 500, 502, 503) with exponential backoff

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM) |
| Framework | Express.js |
| LLM | Groq API (configurable model) |
| Database | MySQL 8.0 |
| DB Driver | mysql2 (connection pool, prepared statements) |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |

## Prerequisites

- **Node.js** >= 20
- **MySQL** >= 8.0 (running locally or accessible remotely)
- **Groq API key** ([get one free](https://console.groq.com))

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yourusername/traceiq.git
cd traceiq
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MySQL credentials and Groq API key

# 3. Create database and schema
npm run db:setup

# 4. Seed with sample data
npm run db:seed

# 5. Run tests
npm test

# 6. Start the server
npm start
```

The server starts on `http://localhost:3001`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Database connectivity check |
| `POST` | `/api/investigate` | Submit an investigation question |
| `GET` | `/api/investigations` | List all past investigations |
| `GET` | `/api/investigate/:id` | Retrieve a persisted investigation |

### Example Request

```bash
curl -X POST http://localhost:3001/api/investigate \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did our orders drop yesterday compared to the previous 7 days?"}'
```

### Example Response

```json
{
  "investigationId": "123e4567-e89b-12d3-a456-426614174000",
  "question": "Why did our orders drop yesterday compared to the previous 7 days?",
  "status": "completed",
  "answer": "**Conclusion:** Orders dropped due to...\n\n**Key Evidence:**\n- ...\n\n**Confidence:** High",
  "steps": 6,
  "sqlQueries": 4,
  "toolCalls": [...],
  "errors": [],
  "totalDuration": 12340
}
```

### Retrieve Past Investigation

```bash
curl http://localhost:3001/api/investigate/123e4567-e89b-12d3-a456-426614174000
```

### List All Investigations

```bash
curl http://localhost:3001/api/investigations
```

## Configuration

All configuration is via environment variables (loaded from `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | *required* | Groq API key for LLM access |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | LLM model to use |
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_USER` | *required* | MySQL username |
| `MYSQL_PASSWORD` | *(empty)* | MySQL password |
| `MYSQL_DATABASE` | *required* | Database name (default: `traceiq`) |
| `MAX_AGENT_STEPS` | `8` | Max reasoning steps per investigation |
| `MAX_SQL_QUERIES` | `5` | Max SQL queries per investigation |
| `MAX_QUERY_ROWS` | `500` | Max rows returned per query |
| `MAX_EXECUTION_TIME_MS` | `60000` | Max wall-clock time (ms) |
| `MAX_QUERY_TIMEOUT_MS` | `30000` | MySQL query timeout (ms) |
| `MAX_QUESTION_LENGTH` | `5000` | Max characters in input question |

## Database Schema

### Data Tables

```
customers
├── id (PK)
├── name, email (UNIQUE)
├── country, segment (enterprise/smb/consumer)
├── device_preference (mobile/desktop/tablet)
└── created_at, updated_at

products
├── id (PK)
├── name, category, price, cost
├── active (boolean)
└── created_at, updated_at

orders
├── id (PK)
├── customer_id (FK -> customers)
├── status (completed/pending/cancelled/refunded)
├── total_amount
└── created_at, updated_at

order_items
├── id (PK)
├── order_id (FK -> orders)
├── product_id (FK -> products)
├── quantity, unit_price
└── created_at

payments
├── id (PK)
├── order_id (FK -> orders)
├── amount, method, status
├── failure_reason
└── created_at
```

### Audit Tables

```
investigations
├── id (PK, UUID)
├── question, status (running/completed/failed)
├── started_at, completed_at, duration_ms
├── steps, sql_queries, final_answer, error
└── created_at

investigation_steps
├── id (PK, AUTO_INCREMENT)
├── investigation_id (FK -> investigations)
├── step_number, tool_name
├── tool_input (JSON), tool_output (JSON)
├── duration_ms
└── created_at
```

## Seed Data Anomalies

The seed dataset contains **5 intentional anomalies** designed to test whether the agent discovers them:

| # | Anomaly | Description |
|---|---------|-------------|
| 1 | **Russian order stop** | Orders from Russia cease after day 22 (simulated payment gateway block) |
| 2 | **Mobile payment failures** | Mobile users experience a 40% payment failure rate in the last 10 days (checkout bug) |
| 3 | **Deactivated product surge** | Product deactivated 15 days ago had a spike of returns |
| 4 | **Enterprise bulk cancellation** | One enterprise customer cancelled 3 orders simultaneously 5 days ago |
| 5 | **USA mobile checkout drop** | Failed A/B test on mobile checkout caused a decline in USA consumer mobile orders |

## Evaluation Framework

TraceIQ includes a deterministic evaluation framework for measuring agent performance against known anomalies.

```bash
npm run eval    # Run all evaluation scenarios (requires live Groq API + MySQL)
```

The evaluation tests 3 scenarios against the seeded anomalies:
1. **Russian Order Decline** — agent should identify country-based order stoppage
2. **Mobile Payment Failures** — agent should identify device-specific payment failure spike
3. **Enterprise Bulk Cancellation** — agent should identify enterprise customer cancellation pattern

## Project Structure

```
traceiq/
├── config/
│   └── env.js                  # Environment validation (Zod)
├── database/
│   ├── mysql.js                # Connection pool, query helpers
│   ├── queries.js              # Pre-built analytical queries
│   └── investigation-store.js  # Investigation persistence layer
├── security/
│   └── sql-validator.js        # SQL injection/writes blocker
├── tools/
│   ├── registry.js             # Tool registration and dispatch (Zod validation)
│   ├── schema.tool.js          # get_schema tool
│   ├── sql.tool.js             # execute_sql tool
│   └── stats.tool.js           # get_stats tool
├── agent/
│   ├── agent.js                # Agentic loop orchestrator
│   ├── prompts.js              # System prompt builder
│   └── state.js                # Bounded investigation state
├── llm/
│   └── groq.js                 # Groq API client
├── evaluation/
│   ├── assertions.js           # Assertion helpers for eval
│   ├── runner.js               # Scenario runner
│   └── scenarios/              # Evaluation scenario definitions
│       ├── russian-order-decline.js
│       ├── mobile-payment-failures.js
│       └── enterprise-bulk-cancellation.js
├── routes/
│   └── investigation.routes.js # API route definitions
├── controllers/
│   └── investigation.controller.js # Request handlers
├── src/
│   └── server.js               # Express server entry point
├── sql/
│   ├── schema.sql              # DDL statements
│   └── seed.sql                # Deterministic seed data
├── scripts/
│   ├── setup-db.js             # Create DB + apply schema
│   ├── seed-db.js              # Insert seed data
│   ├── reset-db.js             # Drop, recreate, and reseed
│   ├── setup-readonly-user.js  # Create read-only MySQL user
│   ├── benchmark.js            # Performance benchmark
│   └── eval.js                 # Evaluation runner
├── tests/
│   ├── agent.test.js           # Agent loop tests
│   ├── config.test.js          # Configuration tests
│   ├── database.test.js        # Connection tests
│   ├── evaluation.test.js      # Evaluation framework tests
│   ├── groq.test.js            # LLM client tests
│   ├── health.test.js          # API endpoint tests
│   ├── investigation-store.test.js # Persistence tests
│   ├── performance.test.js     # Performance tests
│   ├── schema.test.js          # Table/column/FK validation
│   ├── seed.test.js            # Row count + anomaly checks
│   ├── sql-security.test.js    # Security rule tests
│   ├── sql-tool.test.js        # SQL tool tests
│   ├── sql-validator.test.js   # Validator tests
│   ├── tool-registry.test.js   # Registry tests
│   └── tool-validation.test.js # Tool input validation tests
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Testing

```bash
# Run all unit/integration tests
npm test

# Run in watch mode
npm run test:watch

# Run evaluation scenarios (requires live Groq + MySQL)
npm run eval
```

**Test coverage:**

| Test Suite | Tests | What It Validates |
|-----------|-------|-------------------|
| `agent.test.js` | 24 | Agent loop, tool dispatch, state limits, errors |
| `config.test.js` | 2 | Configuration determinism in test mode |
| `database.test.js` | 2 | MySQL connectivity, correct database |
| `evaluation.test.js` | 23 | Evaluation assertions, scenario runner, definitions |
| `groq.test.js` | 18 | LLM client, error handling, retries, configurable model |
| `health.test.js` | 7 | Health endpoint, input validation, question length, list investigations |
| `investigation-store.test.js` | 12 | CRUD operations, ID generation |
| `performance.test.js` | 18 | SQL dedup, batch handling, limits |
| `schema.test.js` | 4 | All 7 tables exist, columns, foreign keys |
| `seed.test.js` | 8 | Row counts, all anomalies present |
| `sql-security.test.js` | 47 | SQL injection, blocked operations, LIMIT enforcement |
| `sql-tool.test.js` | 23 | SQL tool execution, validation, dedup |
| `sql-validator.test.js` | 14 | Validator rules, edge cases |
| `tool-registry.test.js` | 12 | Registration, dispatch, errors |
| `tool-validation.test.js` | 12 | Zod schema validation for all tools |

## Database Management

```bash
npm run db:setup    # Create database and apply schema
npm run db:seed     # Insert seed data (idempotent)
npm run db:reset    # Drop, recreate, and reseed from scratch
npm run db:setup-readonly  # Create read-only MySQL user
```

## Security

- The LLM **never** directly accesses MySQL
- All SQL queries pass through a validation layer before execution
- Only `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` are permitted
- Blocked: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`
- Injection patterns blocked: multi-statement (`;`), `SLEEP()`, `BENCHMARK()`, `LOAD_FILE()`
- Row limits enforced at the tool level (`MAX_QUERY_ROWS`)
- Hard autonomy limits enforced by the agent runtime, not the LLM
- All tool inputs validated via Zod schemas before execution
- Input validation: question length capped at `MAX_QUESTION_LENGTH` (default: 5000 chars)

## License

MIT

---

<div align="center">

Built with the understanding that the LLM is a powerful reasoning engine, but the application must remain in control.

</div>
