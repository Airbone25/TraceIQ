<div align="center">

# Whybase

### AI Database Investigation Agent

An autonomous agent that investigates business questions by exploring a MySQL database, forming hypotheses, running SQL queries, and delivering evidence-backed conclusions.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-330%20passing-brightgreen)](#testing)

</div>

---

## What Is This?

Whybase is a production-grade AI agent that answers business questions by autonomously investigating a MySQL database. It is **not** a chatbot or a simple text-to-SQL wrapper. It is an agentic system that thinks, plans, executes, observes, and iterates.

**Example question:**
> "Why did our orders drop yesterday compared to the previous 7 days?"

**What Whybase does:**

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
- **LLM retry with backoff** — automatic retry on transient API errors (429, 413 token-limit, 500, 502, 503) with exponential backoff
- **Context protection** — configurable `max_tokens`, tool result truncation, conversation history compression, and retryable handling of provider TPM limits (e.g., Groq free tier)
- **Convergence safeguards** — endgame nudge as budgets run low, forced final synthesis when limits hit, and per-investigation tool result caching to avoid repeat queries
- **Concurrency guard** — in-process rate limiter queues or rejects overlapping investigations so parallel requests cannot exhaust provider token budgets
- **Async job execution** — `POST /api/investigate` returns `202` immediately and runs in the background; orphaned runs are reconciled as failed on server restart
- **Investigation threads with follow-ups** — ask follow-up questions that continue from prior findings in a ChatGPT-style conversation, with prior answers injected as bounded context
- **Bring your own database** — register any MySQL server (host/user/password) in the UI or API; credentials are encrypted at rest (AES-256-GCM), databases are browsable per connection, and each chat can target a different database
- **User accounts** — email/password sign-up with bcrypt hashing; sessions via signed JWTs in httpOnly cookies; every connection, thread, and investigation is private to its owner
- **Schema-agnostic investigations** — an auto-injected database overview (table sizes + date ranges) grounds the agent on any schema; no domain-specific tooling required
- **Web dashboard** — built-in chat UI served at `/`: sidebar of investigation threads, live step progress while investigating, rendered evidence-backed answers

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
| Desktop shell | Electron (local-only server, sandboxed preload) |

## Prerequisites

- **Node.js** >= 20
- **MongoDB** (a running instance, default `mongodb://127.0.0.1:27017`) to store accounts and product data
- **MySQL** >= 8.0 (running locally or accessible remotely) — the databases the agent investigates
- **Groq API key** ([get one free](https://console.groq.com))

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yourusername/traceiq.git
cd traceiq
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI, Groq API key, and MySQL settings

# 3. Point the app at a MongoDB (or use the default local instance). The app
#    creates its own data store on first boot — no manual schema setup needed.

# 4. (Optional) Set up and seed a MySQL database you want to investigate
npm run db:setup
npm run db:seed

# 5. Run tests
npm test

# 6. Start the server
npm start
```

The server starts on `http://localhost:3001`. Open it in a browser for the built-in investigation dashboard.

### Data store (MongoDB)

Your account, Groq key, saved connections, threads and investigations are stored in MongoDB via `MONGODB_URI` (a standard `mongodb://` connection string). For local development the default `mongodb://127.0.0.1:27017/traceiq` is fine.

For any shared or remote host, **enable MongoDB authentication** and include the credentials in the URI, e.g. `mongodb://USER:PASS@host:27017/traceiq`. Don't expose an unauthenticated instance: this store holds users' connection passwords and Groq API keys (encrypted at rest with `APP_SECRET`), which should not be readable by anyone who can reach the database.

> **Public deployments:** in a published build the MongoDB connection string ships inside the app and cannot be changed by the user. Because MongoDB grants are database‑scoped (not per‑account), anyone who can extract the URI from the client can connect to the cluster as that DB user and read every user's account, email and (plaintext) threads and investigations. To ship a public build responsibly: create a **dedicated Atlas DB user** with the least privileges the app needs (`readWrite` on the `traceiq` database; never the cluster/Atlas root), leave network access wide enough for arbitrary end‑users, and keep TLS enabled (Atlas default). Only saved connection passwords and Groq keys are encrypted at rest; all other user data is stored as plaintext in MongoDB.

## Desktop App (Electron)

Whybase ships as a desktop app so you can run investigations without git/npm/self‑hosting friction. The agent and Express server run entirely on your machine, bound to `127.0.0.1` only; your account and data are stored in a fixed MongoDB Atlas cluster that the app connects to directly. The MongoDB connection string is baked into the build and is not editable from Settings.

- On first launch you see the **Login / Sign up** screen. Your account is stored in the app's data store (MongoDB), not edited in the UI.
- The first time you log into an account, a short setup screen asks for your **Groq API key only** (model is fixed server‑side). The key is validated before you enter the app and stored per‑account in the data store; the default model is not user‑editable.
- **Settings** (in‑app gear icon, or the macOS app menu) lets you update your password/email and re‑enter/re‑verify your Groq key. The desktop settings window also lets you set the server port, plus offers an "Open user data folder" action and version/about info. The MongoDB data store is fixed in the build and shown read‑only.
- Your Groq key and the auto‑generated `APP_SECRET` are stored per‑machine/account and never committed to the repo.
- External links (e.g. the Groq console) always open in your system browser. The renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and a sandboxed preload.
- For investigation connections you add inside the app, always use a MySQL user with **read‑only** privileges.

### Run from source

```bash
npm install
npm run desktop
```

### Package installers

```bash
npm run desktop:dist        # builds for current OS into release/
npm run desktop:dist:win    # Windows NSIS (x64) — primary, tested
npm run desktop:dist:linux  # Linux AppImage (x64) — run on Ubuntu/Debian
npm run desktop:dist:mac    # macOS dmg (x64+arm64) — requires macOS host
npm run desktop:pack        # unpacked app for quick local test
```

**Windows:** Tested. NSIS installer `release/Whybase Setup *.exe` (non-oneClick, choosable directory). No icon required — uses Electron default.

**Linux/mac — how to set up:**
- *Linux:* `npm run desktop:dist:linux` on Ubuntu 22+ (`libarchive-tools` installed). Produces `Whybase-*.AppImage` (portable) — mark executable `chmod +x` and run. For `deb` add `"deb"` to `build.linux.target` (requires `fakeroot`). No code change.
- *mac:* `npm run desktop:dist:mac` **must run on macOS** (GitHub `macos-latest` runner). Requires `CSC_LINK` (p12) + `APPLE_ID` notarization secrets for distribution outside App Store. The `mac` config in `package.json:build.mac` already targets `dmg` for `x64`+`arm64`. Build on Windows/Linux will fail for `mac` — use CI.

**GitHub public release + auto-update:**
- `package.json:build.publish` points to `Airbone25/Whybase` via `electron-updater`. Push a tag `git tag v1.0.1 && git push origin v1.0.1` — `.github/workflows/release.yml` builds `win` (and optionally `linux`/`mac` when uncommented) and publishes `release/*.exe` + `latest.yml` to Releases.
- **Required repository secrets** (Settings → Secrets and variables → Actions). The CI build bakes these into the installer, so without them a packaged app silently defaults to a local MongoDB and dev-mode email (OTP never sent):
  - `MONGODB_URI` — Atlas/remote URI for product data (accounts, threads, connections)
  - `SMTP_USER` — Gmail address used as the OTP sender (e.g. `keshavmehra2005@gmail.com`)
  - `SMTP_PASS` — Gmail **App Password** for that account (16 chars; requires 2-Step Verification enabled). Leave empty for dev mode (OTP logged)
  - `EMAIL_FROM` — e.g. `Whybase <keshavmehra2005@gmail.com>`
  - `APP_SECRET` — 64-char hex (keep the same value across releases so stored credentials stay decryptable)
  - Optional `SMTP_HOST`, `SMTP_PORT` (defaults `smtp.gmail.com`/`465`), `GROQ_MODEL`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (MySQL defaults are configurable in-app anyway)
  - OTP email requires real SMTP creds: Resend's `onboarding@resend.dev` sender only delivers to the Resend account owner's inbox, so never ship with that as `EMAIL_FROM`.
- Client `electron/main.cjs` checks `autoUpdater.checkForUpdatesAndNotify()` 5s after boot + every 6h, prompts `Restart` when downloaded. Works only in packaged builds (`app.isPackaged`). Provide `GH_TOKEN` automatically via `secrets.GITHUB_TOKEN`; no extra setup.
- Manual publish: `npm run desktop:publish` (Windows) or `desktop:publish:all` (needs all runners). For local test without publish use `desktop:dist:*`. To rebuild/patch an already-published version, re-run the workflow via **Actions → Release → Run workflow** (releases to the same `v<version>` tag with `--clobber`).
- Note: release builds run from a clean checkout where the gitignored `.env` is absent; the workflow regenerates `.env` from the secrets above before building.

Config file location (Windows): `%APPDATA%\Whybase\config.json`.

```json
{
  "groqApiKey": "gsk_...",
  "groqModel": "openai/gpt-oss-120b",
  "appSecret": "<auto-generated 64-char hex>",
  "mongodbUri": "mongodb+srv://... (baked in at build time)",
  "serverPort": 39101,
  "metadata": {
    "mysqlHost": "127.0.0.1",
    "mysqlPort": 3306,
    "mysqlUser": "root",
    "mysqlPassword": "",
    "mysqlDatabase": "traceiq"
  },
  "limits": { "maxAgentSteps": 8 }
}
```

`mongodbUri` is baked into the build (not user‑editable) and points at the cluster where your account and product data are stored; `metadata.*` is the optional MySQL server you point investigations at (used by the seed/setup and evaluation scripts).

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Database connectivity check (public) |
| `POST` | `/api/auth/register` | Create an account (`email`, `password` ≥ 8 chars) → sets session cookie |
| `POST` | `/api/auth/login` | Sign in → sets session cookie (`401` on bad credentials) |
| `POST` | `/api/auth/logout` | Clear the session cookie |
| `GET` | `/api/auth/me` | Current account from the session cookie |

All endpoints below require a valid session cookie and return data scoped to the signed-in user.

| Method | Endpoint | Description |
| `POST` | `/api/investigate` | Submit an investigation question → `202 {investigationId}` (runs in background) |
| `GET` | `/api/investigations` | List all past investigations |
| `GET` | `/api/investigate/:id` | Retrieve a persisted investigation with its step timeline |
| `POST` | `/api/threads` | Start an investigation thread → `202 {threadId, investigationId}`; optional `connectionId` + `database` target a registered MySQL server |
| `GET` | `/api/threads` | List threads with latest status and message counts |
| `GET` | `/api/threads/:id` | Thread detail: messages, runs, and latest run steps |
| `POST` | `/api/threads/:id/messages` | Ask a follow-up that continues from prior findings (`409` while a run is active) |
| `POST` | `/api/connections` | Register a MySQL server (`name`, `host`, `port`, `user`, `password`) — verified before storing; password encrypted at rest |
| `GET` | `/api/connections` | List registered connections (never returns credentials; includes `last_used_at`) |
| `GET` | `/api/connections/health` | Live health check for every saved connection (`{connections: [{id, name, healthy, latencyMs, error}]}`) |
| `DELETE` | `/api/connections/:id` | Remove a connection and its cached pools |
| `GET` | `/api/connections/:id/databases` | List user databases on that server (system schemas filtered) |
| `GET` | `/api/connections/:id/schema?database=NAME` | Tables + columns across a server (or one database) via INFORMATION_SCHEMA |
| `POST` | `/api/connections/:id/sample-dataset` | One-click provision of a fresh `traceiq_sample` database (schema + seeded data) on that server |

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
  "status": "queued"
}
```

Poll `GET /api/investigate/123e4567-...` until `status` is `completed`, then read `final_answer`, `steps`, and the full `steps[]` tool timeline.

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
| `GROQ_API_KEY` | *required* | Fallback Groq API key. Per-account keys stored in the data store override this per-request |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | LLM model to use |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/traceiq` | Where accounts and product data are stored |
| `MYSQL_HOST` | `localhost` | Target MySQL host (seed/eval only) |
| `MYSQL_PORT` | `3306` | Target MySQL port |
| `MYSQL_USER` | `root` | Target MySQL username |
| `MYSQL_PASSWORD` | *(empty)* | Target MySQL password |
| `MYSQL_DATABASE` | `traceiq` | Target MySQL database |
| `MAX_AGENT_STEPS` | `8` | Max reasoning steps per investigation |
| `MAX_SQL_QUERIES` | `5` | Max SQL queries per investigation |
| `MAX_QUERY_ROWS` | `500` | Max rows returned per query |
| `MAX_EXECUTION_TIME_MS` | `60000` | Max wall-clock time (ms) |
| `MAX_QUERY_TIMEOUT_MS` | `30000` | MySQL query timeout (ms) |
| `MAX_QUESTION_LENGTH` | `5000` | Max characters in input question |
| `LLM_MAX_TOKENS` | `1024` | Max completion tokens per LLM call (counts toward provider TPM limits) |
| `MAX_TOOL_RESULT_CHARS` | `4000` | Max characters of a tool result kept in LLM message history |
| `MAX_CONTEXT_CHARS` | `12000` | Conversation history budget; older tool results are compressed to stubs beyond this |
| `MAX_CONCURRENT_INVESTIGATIONS` | `1` | Max investigations running at once (protects provider TPM limits) |
| `INVESTIGATION_QUEUE_TIMEOUT_MS` | `10000` | How long a queued investigation waits before failing with a queue-timeout error |
| `THREAD_CONTEXT_TURNS` | `3` | Max prior Q&A turns injected as context for follow-up questions |
| `THREAD_CONTEXT_ANSWER_CHARS` | `2000` | Per-answer character cap when injecting thread context |
| `APP_SECRET` | *(insecure default)* | 64-char hex key used to encrypt stored connection passwords (AES-256-GCM) **and** to sign session JWTs. **Set this in any non-local deployment** — a warning is logged at startup when unset |

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
investigation_threads
├── id (PK, UUID)
├── title
├── user_id (nullable FK -> users)
├── connection_id (nullable FK -> db_connections)
├── target_database (nullable) — database this chat investigates
└── created_at, updated_at

db_connections
├── id (PK, UUID)
├── name (unique per user display name)
├── host, port, db_user
├── password_enc — AES-256-GCM ciphertext
├── user_id (nullable FK -> users)
├── last_used_at — set whenever a chat binds/uses this connection
└── created_at

users
├── id (PK, UUID)
├── email (unique)
├── password_hash — bcrypt
└── created_at

investigations
├── id (PK, UUID)
├── thread_id (nullable FK -> investigation_threads)
├── question, status (running/completed/failed)
├── started_at, completed_at, duration_ms
├── steps, sql_queries, final_answer, error
└── created_at

investigation_messages
├── id (PK, AUTO_INCREMENT)
├── thread_id -> investigation_threads
├── role (user/assistant), content
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

Whybase includes a deterministic evaluation framework for measuring agent performance against known anomalies.

```bash
npm run eval    # Run all evaluation scenarios (requires live Groq API + MySQL)
npm run eval -- --only=russian-order-decline              # Single scenario
npm run eval -- --only=mobile-payment-failures,enterprise-bulk-cancellation  # Multiple
```

Available scenario IDs: `russian-order-decline`, `mobile-payment-failures`, `enterprise-bulk-cancellation`, `deactivated-product-surge`, `usa-mobile-checkout-drop`.

> **Free-tier economics:** Each scenario consumes roughly 30–60k tokens. Groq's free tier allows ~200k tokens/day, so a full eval run uses most of the daily budget. Use `--only` to rerun individual failed scenarios without exhausting the limit.

The evaluation tests 5 scenarios against the seeded anomalies:
1. **Russian Order Decline** — agent should identify country-based order stoppage
2. **Mobile Payment Failures** — agent should identify device-specific payment failure spike
3. **Enterprise Bulk Cancellation** — agent should identify enterprise customer cancellation pattern
4. **Deactivated Product** — agent should find the inactive Legacy Adapter and its sales status
5. **USA Mobile Checkout Drop** — agent should detect the recent decline in USA mobile orders

When an investigation exhausts its step/time budget before concluding naturally, the agent injects an endgame nudge and then makes one forced synthesis call to produce the best answer from gathered evidence instead of returning empty results.

## Project Structure

```
traceiq/
├── config/
│   └── env.js                  # Environment validation (Zod)
├── electron/                   # Desktop shell (Electron)
│   ├── main.cjs                # Main process: config, server lifecycle, windows, menu
│   ├── preload.cjs             # Sandboxed contextBridge API
│   ├── desktop-config.cjs      # userData config load/save + env mapping
│   ├── desktop-server.cjs      # Spawn/stop the local server, health check, schema
│   └── desktop/                # first-run, settings, loading pages
├── database/
│   ├── mysql.js                # Connection pool, query helpers
│   ├── queries.js              # Generic schema introspection helpers
│   ├── investigation-store.js  # Investigation persistence layer
│   └── thread-store.js         # Thread/message persistence for follow-ups
├── services/
│   └── job-runner.js           # Background investigation executor
├── security/
│   └── sql-validator.js        # SQL injection/writes blocker
├── tools/
│   ├── registry.js             # Tool registration and dispatch (Zod validation)
│   ├── schema.tool.js          # get_schema tool
│   ├── sql.tool.js             # execute_sql tool
│   └── overview.tool.js        # get_overview tool (row counts + date ranges, any schema)
├── agent/
│   ├── agent.js                # Agentic loop orchestrator
│   ├── context.js              # Conversation history compression
│   ├── prompts.js              # System prompt builder
│   └── state.js                # Bounded investigation state
├── llm/
│   ├── groq.js                 # Groq API client
│   └── rate-limiter.js         # Concurrency guard with queueing
├── evaluation/
│   ├── assertions.js           # Assertion helpers for eval
│   ├── runner.js               # Scenario runner
│   └── scenarios/              # Evaluation scenario definitions
│       ├── russian-order-decline.js
│       ├── mobile-payment-failures.js
│       ├── enterprise-bulk-cancellation.js
│       ├── deactivated-product-surge.js
│       └── usa-mobile-checkout-drop.js
├── routes/
│   └── investigation.routes.js # API route definitions
├── controllers/
│   ├── investigation.controller.js # Request handlers (legacy + health)
│   └── threads.controller.js   # Thread/follow-up request handlers
├── public/                     # Built-in web dashboard (vanilla SPA)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
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
| `agent.test.js` | 31 | Agent loop, tool dispatch, state limits, errors, thread context injection, stall guard, overview injection |
| `config.test.js` | 2 | Configuration determinism in test mode |
| `context.test.js` | 14 | History compression: stubs, message shape, budgets |
| `database.test.js` | 2 | MySQL connectivity, correct database |
| `endgame.test.js` | 17 | Endgame nudges, forced synthesis, tool result caching |
| `evaluation.test.js` | 26 | Evaluation assertions, scenario runner, definitions |
| `groq.test.js` | 21 | LLM client, error handling, retries, configurable model |
| `health.test.js` | 7 | Health endpoint, input validation, async 202 queueing |
| `investigation-store.test.js` | 14 | CRUD operations, ID generation, thread association |
| `job-runner.test.js` | 9 | Background execution, assistant message persistence, queue timeouts |
| `overview-tool.test.js` | 4 | Schema-agnostic overview: row counts, date ranges, partial failure |
| `performance.test.js` | 18 | SQL dedup, batch handling, limits |
| `prompts.test.js` | 4 | System prompt heuristics: symptom digging, per-group rates, stall message |
| `rate-limiter.test.js` | 9 | Concurrency guard: queueing, FIFO, timeouts |
| `schema.test.js` | 4 | All tables exist, columns, foreign keys |
| `seed.test.js` | 8 | Row counts, all anomalies present |
| `sql-security.test.js` | 47 | SQL injection, blocked operations, LIMIT enforcement |
| `sql-tool.test.js` | 23 | SQL tool execution, validation, dedup |
| `sql-validator.test.js` | 14 | Validator rules, edge cases |
| `thread-store.test.js` | 14 | Thread/message CRUD, active-run checks, context extraction |
| `threads-api.test.js` | 11 | Thread endpoints: create, follow-ups (409), list, detail |
| `tool-registry.test.js` | 12 | Registration, dispatch, errors |
| `tool-validation.test.js` | 11 | Zod schema validation for all tools |

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
