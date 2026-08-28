# Plan

## v0 mock UI (this ship)

Browser shell for Grok Build sessions. Cookie auth, three-pane layout, TUI skin, seeded in-memory adapter. Production build succeeds. Nothing talks to a real grok host.

## v1 remote grok host

Swap MockGrokBuildAdapter for a working RemoteGrokAdapter. Transport is still an open question: ACP stdio, a grok HTTP server, or scanning the remote session directory.

Map adapter methods onto ACP session/new, session/load, session/prompt, session/update plus xAI extensions.

## v2 Google SSO

Add a Google identity provider next to username/password. Keep password auth for local/dev. Allowlist TBD.

## v3 live ACP streaming

Stream session/update to the browser (SSE or WebSocket). Live tokens, tool-call cards, plan ticks, reconnect from the update log.
