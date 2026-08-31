# Design

## Locked decisions (2026-08-28)

1. One machine. HTTPS web UI is the only internet-facing port. Grok ACP
   binds 127.0.0.1. Local IPC is ACP on loopback
   (GROK_ACP_URL=http://127.0.0.1:<port>).
2. New session in the UI creates a real SQLite row + sandbox cwd.
   Rename from the UI and via /rename.
3. Multi-tenant even with one human. Sessions isolated by user.
   Owner can share a session as read-only or read-write. Only the owner
   may delete the session, revoke all shares, or destroy the sandbox.
   Read-write: prompts, rename, /compact, /rewind. Read-only: chat +
   artifacts.
4. Projects are sandboxes under projectsRoot()/<userId>/<projectId>/
   (local-dev: data/sandboxes/...; BUILDINATOR_ROOT: $ROOT/projects/...).
   No arbitrary host path, no `..` traversal. Cross-project in-dev deps
   are explicit links to other registered projects, mounted at
   deps/<name>. Sharing is the grok session, not a host FS login.
   Grok cwd is per session: projectsRoot()/<userId>/<projectId>/sessions/<sessionId>/.
   Sessions are isolated unless an explicit project_links dep exists; they do
   not see sibling sessions or the parent project workspace. Cross-project
   deps still mount at deps/<name> inside the session sandbox.
5. Deployable to one VM you can resize. Dockerfile / compose.
   Not Vercel-first.
6. Hold Google SSO. Username/password stays.
7. Real session/project/share/user metadata in SQLite (WAL,
   better-sqlite3). Transcripts may stay mock-in-memory.
8. TUI skins match Grok Night / Grok Day (screenshots): monospace,
   `>` user prefix, timestamps on the right, dim action lines,
   identifiers, model + variant bottom-right, path + context meter in
   the header, block cursor on the composer. Night is charcoal/teal;
   Day is light gray with blue commands and gold flags.

Concurrent sessions (isolation leaks we closed):

- UI queue, draft, sending, activity, find, and notice are keyed by
  buildinator session id. Switching must not take the previous queue or
  typed draft, mark the new session as sending, or drain the previous
  queue. Background turns keep running; sidebar running dots stay; Esc
  cancels only the visible session. The EventSource for a session stays
  open while that session is sending, so `done` still drains its queue
  and clears the running dot after you switch away.
- `sessions.acp_session_id` is unique (NULLs allowed). Two UI sessions
  must never share a grok ACP thread.
- ACP `fs/read_text_file`, `fs/write_text_file`, and `terminal/create`
  cwd are jailed to that session sandbox. Paths outside are JSON-RPC
  errors. `deps/` may resolve to another linked project via the existing
  symlink (that is the explicit link). This also stops an old ACP
  session whose grok cwd is still the project root from reading sibling
  session files.
- One grok stdio child for every session. `session/prompt` is already
  keyed by ACP session id; overlapping prompts multiplex. Do not spawn
  one grok process per session and do not globally lock sending across
  sessions.
- `--always-approve` is process-wide (spawn flag). The UI picker can
  stay and is stored per session; changing it does not respawn grok.

/resume and /fork are **not** in-session slashes — they live on the
session row because they deal with things outside the current session.

## Stack

Next.js App Router + TypeScript + Tailwind + better-sqlite3.

- App Router: pages and API in one process.
- Middleware: cookie JWT gate (jose). Edge-safe; sqlite stays in Node
  route handlers.
- Themes: tui (Grok Night, default), grokday, web (amber dark), light.
  TUI layout is shared by tui + grokday. Picker groups TUI vs web.

## Information architecture

Unauthenticated → /login. Authenticated → /app.

Three panes:

1. Left — owned projects (new session lives here) and **shared with me**.
2. Center — transcript + composer (`>` in TUI). Read-only replaces the
   composer.
3. Right — artifacts. Collapsible (`[` / `]`).

## Data model (SQLite)

dataRoot()/buildinator.sqlite (gitignored). WAL + busy_timeout=5000.

- users — id, username, scrypt password hash, role (admin|write|read),
  disabled
- projects — id, owner_id, name (sandbox path derived, never stored
  as an arbitrary host path)
- project_links — host project → other registered project as deps/<name>
- sessions — id, project_id, owner_id, title, status, model, variant,
  approval, timestamps, token counters
- session_shares — session_id, user_id, role read | write

Transcripts/tool calls/artifacts stay in the mock adapter memory Map.
Seeded session ids get their demo transcripts on process start.

## ACL

requireRole(have, read|write|owner). Missing access is 404;
insufficient role is 403. Owner satisfies write and read.

## Adapter

GrokBuildAdapter is user-scoped. Mock implementation persists index
mutations to sqlite and keeps transcripts in memory.

RemoteGrokAdapter throws with a pointer at loopback ACP. Never expose
that port.

## Auth

Cookie JWT (HS256, jose). sub = user id, username claim. httpOnly,
SameSite=lax, 7-day expiry. Authorization uses `users.role` from
SQLite on each request, not the JWT. Seeded user hashed with scrypt.

## TUI

Not a second app. ThemeProvider writes data-theme + localStorage.
Default is TUI (Grok Night). Keyboard: j/k sessions, n new, [ ]
artifacts, t cycle theme, / composer (slash list). Ignored while typing.

## What we did not copy

xai-org/grok-build source stays out of this repo.

## Subagent trees (ACP parents)

Official ACP has no standard `parentToolCallId`. Claude Code puts a vendor
parent on `_meta.claudeCode.parentToolUseId`. Grok `tool_call` updates look
like `{ toolCallId, title, kind, rawInput, _meta["x.ai/tool"] }` with names
such as `read_file`, `web_search`, `task`, `grep`. Grok `task` is a subagent
spawn; child tools are **not** reliably attributed to that task (Copilot even
flattens subagent text into the parent stream). Local grok logs here did not
show a grok-specific parent field we could trust.

Buildinator shows subagents in the right artifacts pane **only** when `_meta.parentToolCallId`,
`_meta.claudeCode.parentToolUseId`, or `_meta["x.ai/tool"].parentToolCallId`
is present. We never infer a tree from timing. `task` still renders as a
spawn node with no children. `_x.ai/queue/interject` and
`_x.ai/toggle_plan_mode` are not callable (`-32601`); the composer queue is
client-side. `session/set_model` `{sessionId, modelId}` and `session/set_mode`
`{sessionId, modeId}` (effort: low/medium/high) work. Permission is spawn
`--permission-mode` / `--always-approve` plus `session/new` `_meta.yoloMode` /
`autoMode`. One shared grok child serves every session; we do not respawn it
to change permission.
