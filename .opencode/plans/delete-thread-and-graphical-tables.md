# Plan: Thread Delete + Graphical Tables in Chat

Approved by user. Two features for the TraceIQ chat dashboard.

## Feature 1 — Delete thread

### Backend
1. `database/thread-store.js` — add `deleteThread(id)`:
   - Return `false` if thread doesn't exist (reuse `getThread`)
   - Delete in FK-safe order:
     1. `DELETE FROM investigation_steps WHERE investigation_id IN (SELECT id FROM investigations WHERE thread_id = ?)`
     2. `DELETE FROM investigations WHERE thread_id = ?`
     3. `DELETE FROM investigation_messages WHERE thread_id = ?`
     4. `DELETE FROM investigation_threads WHERE id = ?`
   - Log + return `true`
2. `controllers/threads.controller.js` — add `deleteThreadHandler`:
   - `404 {error}` if store returns false
   - else `204` no content
3. `routes/investigation.routes.js` — `router.delete('/threads/:id', deleteThreadHandler)`

### Frontend
4. `public/js/app.js`:
   - Sidebar thread items get a delete button (trash icon), visible on hover
   - Click → native `confirm('Delete this investigation?')` → if confirmed:
     - `DELETE /api/threads/:id`
     - `refreshThreads()`
     - If deleted thread was active (`state.activeThreadId === id`) → `newThread()` reset
5. `public/css/styles.css`:
   - `.thread-item` becomes flex container with `.thread-delete-btn` hidden (`opacity:0`) until `.thread-item:hover`
   - Button styling: transparent bg, dim text, red on hover

## Feature 2 — Graphical tables in answers

6. `public/js/app.js` — extend `renderRichText(text)`:
   - Pre-scan lines; group consecutive lines whose trimmed form starts with `|` into table blocks
   - Parse block: row 0 = header cells; row 1 if separator (`/^[\s|:-]+$/`) skip; remaining = body rows
   - Split rows on `|`, trim cells, drop leading/trailing empties from edge pipes
   - Emit `<div class="table-wrap"><table class="answer-table"><thead>...<tbody>...</table></div>`
   - Apply `inlineFormat()` to each cell; add class `num` to cells matching `/^-?[\d,.]+%?$/` for right alignment
7. `public/css/styles.css`:
   - `.answer-table`: width 100%, border-collapse collapse, font-size 13.5px
   - th: background var(--bg-composer), text-align left
   - td/th: border 1px solid var(--border), padding 7px 10px
   - tbody tr:nth-child(even): subtle zebra background
   - td.num: text-align right, font-variant-numeric tabular-nums
   - `.table-wrap`: overflow-x auto, margin-bottom 10px

## Tests
8. `tests/thread-store.test.js` — `deleteThread`:
   - returns false for unknown id (no deletes issued)
   - issues 4 deletes in correct order with correct params
9. `tests/threads-api.test.js`:
   - `DELETE /api/threads/:id` → 204 on success
   - → 404 for unknown thread
10. Update mocked thread-store module in `tests/threads-api.test.js` to include `deleteThread`

## Verification
- `npm test` full suite green
- Restart server; live check: DELETE endpoint via curl, UI loads
- User visually confirms table rendering + delete button in browser
- Commit: `feat: thread deletion and graphical markdown tables in chat answers`
