# Plan

## v1 (this ship)

Single self-contained machine. HTTPS web UI is the only internet port.
Grok ACP binds 127.0.0.1. SQLite metadata, sandbox projects, session
sharing, Grok Night TUI default, username/password (Google held).

## v1.1 remote grok host

Fill in RemoteGrokAdapter against GROK_ACP_URL=http://127.0.0.1:<port>.
Spawn or attach a grok sidecar on loopback. Map adapter methods onto
ACP session/new, session/load, session/prompt, session/update
plus xAI extensions (rename, rewind, compact, fork).

## v2 Google SSO (held)

Do not implement until asked. Keep username/password.

## v3 live ACP streaming

Stream session/update to the browser (SSE or WebSocket). Live tokens,
tool-call cards, plan ticks, reconnect from the update log.
