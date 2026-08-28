# Questions for the morning

Please answer these so v1 is not a guess.

1. **Remote host protocol.** Should buildinator talk ACP over stdio to a grok process, talk to a grok HTTP/WebSocket server, or scan `~/.grok/sessions/<encoded-cwd>/<session-id>/` (summary.json + updates.jsonl) on the remote box? Mix of those?

2. **Spawn vs attach.** Should this app spawn `grok`, or only attach to sessions that already exist? If spawn: as a child on the same box, over SSH, or via a grok-host daemon?

3. **Multi-user vs Scott-only.** Is this a single-user tool (Scott) with a shared secret, or will more people log in? If more people, do they share grok sessions or is each identity isolated?

4. **Where do projects come from.** Scan cwds from the grok session store, explicit register (paste a path), or both? Can a project exist with zero sessions?

5. **Google SSO.** Client id, authorized origins, callback URL, and which Google accounts (or Workspace domain) are allowed? Keep password auth after SSO lands?

6. **Hosting target.** VPS, Fly, Vercel, or local on the grok box? This changes cookie secure flags, whether we can reach stdio, and whether the mock-to-remote swap is same-machine.

7. **Should mock data persist across restarts?** v0 is process memory. Want a JSON file on disk, sqlite, or is restart-wipe fine until v1 talks to real grok state?

8. **How close should the TUI skin match grok-build?** Colors, keybinds, dashboard chrome, box-drawing, status line — pixel homage, or "terminal-ish is enough"? Any screenshots / theme files to copy (not source)?

Also useful if you have a minute:

- Preferred model id to show in the status bar (seeded as grok-4).
- Should /resume /fork /rewind /compact be hidden until they work, or stay as visible stubs?
- Is there already a grok ACP port or auth story on the remote host?
