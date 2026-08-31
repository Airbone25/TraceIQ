# TraceIQ — UI/UX Implementation Plan

Resolved decisions:
- Frontend behavior is **manually verified** — no jsdom test harness (keeps parity with the
  repo's pure-Node/Vitest test setup and avoids brittle DOM tests on the hand-written SPA).
- **SSE with automatic polling fallback** for live updates.
- OTP via **Resend**, verify-at-signup, gated access until verified.

Scope:
1. Auto-grow textarea + keyboard shortcuts (Enter send, Shift+Enter newline, Ctrl+N new thread) — **DONE**
2. Email verification via OTP (Resend) — **DONE**
3. Cancel running investigation — **DONE**
4. SSE live streaming (replace 2s polling, with fallback) - **DONE**

Status: Parts 1-4 implemented and `npm test` green (419 tests). All four UI/UX features complete.

---

## Part 1 — Auto-grow textarea + keyboard shortcuts (frontend only)

Files: `public/js/app.js`, `public/css/styles.css`

- Add a `keydown` handler on `#question-input`:
  - `Enter` without `Shift` (and not composing/IME) -> `preventDefault()` + `els.form.requestSubmit()`.
  - `Shift+Enter` -> insert newline (default) then `autoGrow()`.
- Global `keydown` (extend existing Escape handler): `Ctrl/Cmd+N` -> `newThread(); openNewChatWizard();`
  with `preventDefault()` when not focused in an editable field.
- CSS: add `overflow-y: auto` to `#question-input` (already `max-height:160px`, `resize:none`).
- `autoGrow()` already resets height before measuring.

Verify: manual browser check. No automated tests.

---

## Part 2 — Email verification via OTP (largest)

### Dependency
- `npm i resend`
- New env vars in `.env.example`, `config/env.js` (Zod), `electron/desktop-config.cjs` (`toEnv` passthrough):
  - `RESEND_API_KEY` (empty = dev mode), `EMAIL_FROM`, `EMAIL_OTP_TTL_MIN` (15),
    `EMAIL_OTP_MAX_ATTEMPTS` (5), `EMAIL_OTP_RESEND_SEC` (60).

### New modules
- `services/email.js` — thin Resend wrapper; `sendOtpEmail({ to, otp })`.
  If `RESEND_API_KEY` unset, logs the code (dev) and returns a flag instead of throwing.
- `services/otp.js` — `generateOtp()` (`crypto.randomInt`), `hashOtp()`,
  `createEmailVerification(user)`, `verifyEmailCode(user, code)`
  (constant-time compare, expiry + attempt limit).

### Data model (`database/collections/user.model.js`)
Add `emailVerified` (false), `otpCodeHash`, `otpExpiresAt`, `otpAttempts`, `otpResendAt`.

### Auth rework (`controllers/auth.controller.js`, `routes/investigation.routes.js`, `database/user-store.js`)
- `POST /auth/register` -> create user (`emailVerified:false`), generate + email OTP,
  return `201 { id, email, emailVerified:false, requiresVerification:true }` with NO token.
- `POST /auth/verify-otp` (new) `{ email, code }` -> success returns JWT + `emailVerified:true`;
  wrong -> 400, expired -> 410; over attempts -> invalidate (prompt resend).
- `POST /auth/resend-otp` (new) `{ email }` -> rate-limited by `otpResendAt`, fresh code.
- `POST /auth/login` -> if `!emailVerified` return `403 { error, requiresVerification:true, email }`
  with no token.
- `toUserRow` / `authBodyFromUser` surface `emailVerified`.

### Frontend (`public/index.html`, `public/js/app.js`, `public/css/styles.css`)
- Add `#otp-view` auth card: single 6-digit `inputmode="numeric" maxlength="6"` field,
  Verify button, Resend link (countdown), back/change-email link, `#otp-error`.
- Wire flows: register -> otp-view (no token yet); verify -> token + `me()` + enter;
  login 403 -> otp-view; resend countdown.
- Electron: no shell change; SPA rides the booted server. Only `desktop-config.cjs` env passthrough.

### Tests (Vitest, backend)
- `tests/otp.test.js` (new): generate/hash/expiry/attempt-limit/resend-window.
- `tests/auth-api.test.js`: mock `email.js`; register -> requiresVerification no token;
  verify success -> token; wrong/expired; resend rate-limit; login-before-verify -> 403.
- `tests/user-store.test.js`, `tests/config.test.js`: new fields/env.

---

## Part 3 — Cancel running investigation

Files: `services/job-runner.js`, `agent/agent.js`, `agent/state.js`,
`controllers/threads.controller.js` or `investigation.controller.js`, `routes/investigation.routes.js`,
`database/investigation-store.js` (status `cancelled`), `public/js/app.js`, `public/index.html`.

- `job-runner.js`: add `cancelJob(investigationId)` — set a cancel flag on the job and
  finalize as `cancelled`. Missing id = no-op.
- `agent/agent.js`: accept a `signal`/`shouldAbort` in options; check before each LLM + tool call;
  on abort -> `markCancelled` (new in `state.js`), skip forced synthesis.
  Best-effort thread the signal into `groq.js` `chatCompletion` -> `client.chat.completions.create({ signal })`.
- Routes: `POST /api/investigations/:id/cancel` (auth+ownership, idempotent).
  `DELETE /api/threads/:id` cancels the thread's active run before deleting.
- UI: "Stop" button in the progress card while running; `cancelled` status in
  `renderTerminalAnswer` + sidebar dots.

### Tests
- `tests/job-runner.test.js`: cancel -> status cancelled, releases slot, removes from activeJobs;
  unknown id no-op.
- `tests/agent.test.js`: abort stops loop, marks cancelled, no synthesis.
- `tests/threads-api.test.js`: cancel endpoint 200/404/ownership; thread-delete cancels active run.

---

## Part 4 — SSE live streaming (with polling fallback)

Files (new): `services/notifier.js` (in-process `EventEmitter` keyed by thread/investigation).
Edited: `services/job-runner.js` (emit step/status/answer events),
`controllers/threads.controller.js` (SSE handler), `routes/investigation.routes.js`, `public/js/app.js`.

- Backend: `GET /api/threads/:id/stream` (requireAuth, `text/event-stream`).
  Ownership check -> send full snapshot as first event -> subscribe to notifier -> send deltas ->
  15s heartbeat -> cleanup on `req.on('close')`.
- Frontend: on a running run, open a `fetch`-based SSE reader (Bearer JWT cannot be sent by
  `EventSource`, which only supports cookies), consuming `snapshot`/`update` events to re-render
  the thread detail. Close on thread switch/logout/terminal. Auto-fallback to existing 2s polling
  if the stream errors (keep `pollOnce` as resilience path).
- Keep `GET /api/threads/:id` for hydration + fallback.

### Tests
- `tests/notifier.test.js` (new): subscribe/deliver/cleanup-on-close.
- `tests/threads-api.test.js`: SSE endpoint initializes with snapshot + streams a delta.

---

## Rollout order

1. Part 1 — textarea + shortcuts
2. Part 2 — OTP / Resend
3. Part 3 — cancel investigation
4. Part 4 — SSE streaming

Run `npm test` after each (383 existing + new all green), plus manual `npm start` / `npm run desktop` UI check.

Note: real OTP email delivery requires a Resend API key + verified sending domain/from-address.
Dev fallback (console-logged code when no key is set) means nothing is blocked from building/testing locally.
