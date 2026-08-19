<div align="center">

# TraceIQ

### AI Database Investigation Agent

An autonomous agent that investigates business questions by exploring a MySQL database, forming hypotheses, running SQL queries, and delivering evidence-backed conclusions.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-28%20passing-brightgreen)](#testing)

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
│  │  LLM (Llama 3.3 70B via Groq)                   │    │
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
│  │  MAX_EXECUTION_TIME_MS=30000                     │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    MySQL (Read-Only)                     │
│                    customers · orders · order_items      │
│                    products · payments                   │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Autonomous investigation loop** — LLM decides when to query, when to dig deeper, and when to conclude
- **SQL security** — blocks all write operations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE), injection patterns, and multi-statement attacks
- **Bounded autonomy** — configurable hard limits on steps, queries, rows, and execution time that the LLM cannot override
- **Full audit trail** — every tool call, input, output, timing, and error is persisted
- **Pre-built analytics** — summary statistics for quick overviews before deep-dive queries
- **Deterministic seed data** — realistic business dataset with intentional anomalies for agent evaluation
- **Structured logging** — Pino-based JSON logging across all layers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM) |
| Framework | Express.js |
| LLM | Llama 3.3 70B via [Groq API](https://groq.com) |
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

The server starts on `http://localhost:3000`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Database connectivity check |
| `POST` | `/api/investigate` | Submit an investigation question |

### Example Request

```bash
curl -X POST http://localhost:3000/api/investigate \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did our orders drop yesterday compared to the previous 7 days?"}'
```

### Example Response

```json
{
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

## Configuration

All configuration is via environment variables (loaded from `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | *required* | Groq API key for LLM access |
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_USER` | *required* | MySQL username |
| `MYSQL_PASSWORD` | *(empty)* | MySQL password |
| `MYSQL_DATABASE` | *required* | Database name (default: `traceiq`) |
| `MAX_AGENT_STEPS` | `8` | Max reasoning steps per investigation |
| `MAX_SQL_QUERIES` | `5` | Max SQL queries per investigation |
| `MAX_QUERY_ROWS` | `500` | Max rows returned per query |
| `MAX_EXECUTION_TIME_MS` | `30000` | Max wall-clock time (ms) |

## Database Schema

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
├── customer_id (FK → customers)
├── status (completed/pending/cancelled/refunded)
├── total_amount
└── created_at, updated_at

order_items
├── id (PK)
├── order_id (FK → orders)
├── product_id (FK → products)
├── quantity, unit_price
└── created_at

payments
├── id (PK)
├── order_id (FK → orders)
├── amount, method, status
├── failure_reason
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

## Project Structure

```
traceiq/
├── config/
│   └── env.js                  # Environment validation (Zod)
├── database/
│   ├── mysql.js                # Connection pool, query helpers
│   └── queries.js              # Pre-built analytical queries
├── security/
│   └── sql-validator.js        # SQL injection/writes blocker
├── tools/
│   ├── registry.js             # Tool registration and dispatch
│   ├── schema.tool.js          # get_schema tool
│   ├── sql.tool.js             # execute_sql tool
│   └── stats.tool.js           # get_stats tool
├── agent/
│   ├── agent.js                # Agentic loop orchestrator
│   ├── prompts.js              # System prompt builder
│   └── state.js                # Bounded investigation state
├── llm/
│   └── groq.js                 # Groq API client
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
│   └── reset-db.js             # Drop, recreate, and reseed
├── tests/
│   ├── database.test.js        # Connection tests
│   ├── schema.test.js          # Table/column/FK validation
│   ├── seed.test.js            # Row count + anomaly checks
│   ├── sql-validator.test.js   # Security rule tests
│   └── health.test.js          # API endpoint tests
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Testing

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch
```

**Test coverage:**

| Test Suite | Tests | What It Validates |
|-----------|-------|-------------------|
| `database.test.js` | 2 | MySQL connectivity, correct database selected |
| `schema.test.js` | 4 | All 5 tables exist, correct columns, foreign keys |
| `seed.test.js` | 8 | Row counts, all anomalies present in data |
| `sql-validator.test.js` | 14 | Allowed queries, blocked writes, injection patterns |
| `health.test.js` | 2 | Health endpoint, input validation |

## Database Management

```bash
npm run db:setup    # Create database and apply schema
npm run db:seed     # Insert seed data (idempotent)
npm run db:reset    # Drop, recreate, and reseed from scratch
```

## Security

- The LLM **never** directly accesses MySQL
- All SQL queries pass through a validation layer before execution
- Only `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` are permitted
- Blocked: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`
- Injection patterns blocked: multi-statement (`;`), `SLEEP()`, `BENCHMARK()`, `LOAD_FILE()`
- Row limits enforced at the tool level (`MAX_QUERY_ROWS`)
- Hard autonomy limits enforced by the agent runtime, not the LLM

## Roadmap

- [ ] Structured investigation persistence (database audit log)
- [ ] Streaming responses for long investigations
- [ ] Investigation history and replay
- [ ] Multi-database support
- [ ] Custom tool plugins
- [ ] Web UI for investigation visualization

## License

MIT

---

<div align="center">

Built with the understanding that the LLM is a powerful reasoning engine, but the application must remain in control.

</div>
