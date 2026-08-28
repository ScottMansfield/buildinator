# Questions

Locked 2026-08-28 morning. Answered items stay here so v1.1 does not
re-litigate them.

## Answered

1. **Remote host protocol.** ACP over HTTP to a loopback sidecar:
   GROK_ACP_URL=http://127.0.0.1:<port>. Never published. The HTTPS
   web UI is the only internet port. Local IPC can stay ACP-on-loopback.
2. **Spawn vs attach.** Sidecar on the same VM, bound to 127.0.0.1.
   Real grok spawn is **not live yet** (expected gap).
3. **Multi-user.** Multi-tenant even if currently one human. Session
   storage isolated by user. Owner can share read-only or read-write.
4. **Where projects come from.** Sandboxes under a buildinator-owned
   root. No arbitrary host path, no `..`. Cross-project deps are
   explicit links to other registered projects, mounted at deps/<name>.
5. **Google SSO.** Hold. Keep username/password.
6. **Hosting target.** One VM you can resize. Dockerfile / compose.
   Not Vercel-first.
7. **Persist mock data?** Session/project/share/user metadata in SQLite
   (WAL). Transcripts may remain ephemeral.
8. **TUI fidelity.** Closely match the grok screenshot (Grok Night):
   charcoal/black, monospace, `>` user lines, right-side timestamps,
   dim action lines, teal identifiers, model + variant in the status
   bar, path + context meter in the header.

Slash commands: /compact and /rewind stay in the composer.
/resume and /fork are UI actions on the session row.

Status bar: model id **plus** variant (Grok 4.6 (high) · always-approve).

Demo users: scott / buildinator and guest / guest.

## Still open (v1.1+)

- How to spawn/auth the grok ACP sidecar on the VM (binary, flags,
  credentials). No ACP port exists on the box yet.
- Persist transcripts (sqlite/jsonl) vs keep them ephemeral until real
  ACP session/update is the source of truth.
- TLS certs for 443 (Caddy vs nginx vs Tailscale).
- Live streaming transport (SSE vs WebSocket) — planned as v3.
