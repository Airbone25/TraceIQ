# TraceIQ Cloud API

A small, standalone service that backs the TraceIQ desktop app with **MongoDB Atlas**.

It holds all **product data** — users, Groq ("block") keys, saved connections,
investigation threads, messages, investigations, and steps. It does **not** do
the agent work; the agent runs locally in the desktop app against the user's own
MySQL databases.

## Why this exists

TraceIQ separates two very different kinds of data:

- **Cloud (this API + MongoDB Atlas):** accounts, auth tokens, API keys, saved
  connections, threads, messages, investigations. This is TraceIQ's own state.
- **Local / per-investigation (MySQL):** the target databases the agent queries.
  MySQL is only ever *investigated*; it is never TraceIQ's store.

This API is the single, authenticated boundary for all cloud-side data.

## Architecture

```
Electron desktop app (local)
   │  auth (JWT in localStorage) + all product-data reads/writes
   ▼
TraceIQ Cloud API (this service)  ──►  MongoDB Atlas
   │
   │  (issue JWT, store encrypted Groq keys & connection passwords, threads, ...)
   ▼
(no agent work here)
```

- The local agent only talks to this API to persist progress and to fetch the
  **decrypted** credentials for a connection it needs to investigate (over TLS).
- Groq API keys and MySQL connection passwords are encrypted at rest with
  `DATA_ENCRYPTION_KEY` (AES-256-GCM) and never returned in plaintext except
  over the authenticated `/connections/:id/credentials` call made by the local
  agent.

## Run locally

```bash
cd cloud
npm install
cp .env.example .env   # fill MONGODB_URI, DATA_ENCRYPTION_KEY, JWT_SECRET
npm start              # or: npm run dev
```

## Deploy

Host it anywhere Node runs (Render, Railway, Fly.io, a VPS). Set the env vars:
`PORT`, `MONGODB_URI`, `DATA_ENCRYPTION_KEY`, `JWT_SECRET`. Point the desktop
app's `apiBaseUrl` at the deployed URL.

## API

All routes are under `/api`. Except `/api/health`, `/api/auth/register` and
`/api/auth/login`, every endpoint requires `Authorization: Bearer <JWT>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness |
| POST | `/auth/register` | Create account (returns JWT) |
| POST | `/auth/login` | Sign in (returns JWT + user) |
| POST | `/auth/logout` | Sign out (client discards token) |
| GET | `/auth/me` | Current user |
| DELETE | `/account` | Delete account + all owned data |
| GET | `/keys` | Groq/block key status |
| PUT | `/keys` | Save an API key / model |
| POST | `/keys/verify` | Verify a Groq key |
| GET | `/connections` | List saved connections |
| POST | `/connections` | Create a saved connection |
| POST | `/connections/:id/touch` | Mark last-used |
| GET | `/connections/:id/credentials` | Decrypted target creds for the local agent |
| DELETE | `/connections/:id` | Delete a connection |
| GET | `/threads` | List threads |
| POST | `/threads` | Create thread + initial investigation |
| GET | `/threads/:id` | Thread detail (messages, runs, steps) |
| GET | `/threads/:id/context` | Recent context for follow-ups |
| POST | `/threads/:id/messages` | Queue a follow-up |
| DELETE | `/threads/:id` | Delete a thread + owned data |
| GET | `/investigations` | List investigations |
| GET | `/investigations/:id` | Investigation + steps |
| POST | `/investigations/:id/steps` | Record an agent step |
| PATCH | `/investigations/:id` | Update status / finalize |

## Security notes

- Passwords are hashed with **bcrypt**.
- JWTs are signed with `JWT_SECRET`; the desktop app stores them in `localStorage`.
- Groq keys and MySQL connection passwords are encrypted with `DATA_ENCRYPTION_KEY`
  (AES-256-GCM) before being stored.
- Every operation is scoped to the authenticated user (`userId`).

## Local development conventions

- This package is self-contained with its own `package.json` (adds `mongoose`)
  so the MongoDB driver never leaks into the desktop app's dependency tree.
- `.env` files are gitignored; secrets are never committed.
