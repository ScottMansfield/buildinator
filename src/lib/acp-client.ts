import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import WebSocket from "ws";
import { grokAgentSecret, grokAcpWsUrl, grokPaths } from "./grok-cli";
import { newId } from "./ids";
import { jailSessionPath } from "./sandbox";
import { sessionNewMeta } from "./session-prefs";

export type AcpUpdate = {
  sessionUpdate: string;
  messageId?: string;
  content?: unknown;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  entries?: unknown;
  [key: string]: unknown;
};

export class AcpError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "AcpError";
    this.code = code;
  }
}

export type RewindPoint = {
  promptIndex: number;
  createdAt?: string;
  numFileSnapshots?: number;
  hasFileChanges?: boolean;
  promptPreview?: string;
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseRewindPoint(raw: unknown): RewindPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const promptIndex = asFiniteNumber(o.prompt_index) ?? asFiniteNumber(o.promptIndex);
  if (promptIndex == null) return null;
  return {
    promptIndex,
    createdAt: asString(o.created_at) ?? asString(o.createdAt),
    numFileSnapshots: asFiniteNumber(o.num_file_snapshots) ?? asFiniteNumber(o.numFileSnapshots),
    hasFileChanges: asBoolean(o.has_file_changes) ?? asBoolean(o.hasFileChanges),
    promptPreview: asString(o.prompt_preview) ?? asString(o.promptPreview),
  };
}

export function parseRewindPoints(result: unknown): RewindPoint[] {
  if (Array.isArray(result)) {
    return result.map(parseRewindPoint).filter((p): p is RewindPoint => p != null);
  }
  if (!result || typeof result !== "object") return [];
  const o = result as Record<string, unknown>;
  const arr = o.rewind_points ?? o.rewindPoints;
  if (!Array.isArray(arr)) return [];
  return arr.map(parseRewindPoint).filter((p): p is RewindPoint => p != null);
}

export function highestRewindPoint(points: RewindPoint[]): RewindPoint | null {
  if (points.length === 0) return null;
  return points.reduce((best, p) => (p.promptIndex > best.promptIndex ? p : best));
}

export function compactSlashText(context?: string): string {
  const note = context?.trim();
  return note ? `/compact ${note}` : "/compact";
}

export function isMethodNotFound(err: unknown): boolean {
  if (err instanceof AcpError && err.code === -32601) return true;
  if (err && typeof err === "object" && (err as { code?: unknown }).code === -32601) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /method not found/i.test(msg);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

/** session/load when grok already has this id in the current process. */
export function isAlreadyLoadedError(err: unknown): boolean {
  const msg = errMessage(err);
  return /already loaded|already in memory|session already|duplicate session|already active/i.test(msg);
}

/** session/load when grok has no such session (files gone after restart, unknown id). */
export function isSessionNotFoundError(err: unknown): boolean {
  const msg = errMessage(err);
  return /not found|no such session|unknown session|does not exist|invalid session|no session/i.test(
    msg,
  );
}

function rewindExecuteSuccess(result: unknown): { success: boolean; message?: string } {
  if (!result || typeof result !== "object") return { success: true };
  const o = result as Record<string, unknown>;
  const message = asString(o.message) ?? asString(o.error);
  if (o.success === false) return { success: false, message };
  return { success: true, message };
}


type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type Term = {
  child: ChildProcess;
  output: string;
  limit: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  waiters: Array<(status: { exitCode: number | null; signal: string | null }) => void>;
};

class AcpClient {
  private ws: WebSocket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private starting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 250;
  private updateHandlers = new Map<string, (update: AcpUpdate) => void>();
  private terminals = new Map<string, Term>();
  /** JSON-RPC id of the in-flight session/prompt per ACP session. */
  private promptWaiters = new Map<string, number>();
  /** ACP session ids loaded on THIS websocket since last connect. */
  private loadedSessions = new Set<string>();
  /** acpSessionId → session sandbox absolute path. */
  private sessionSandboxes = new Map<string, string>();
  private fsWriteListeners = new Set<(absPath: string, bytes: number) => void>();

  onFsWrite(fn: (absPath: string, bytes: number) => void): () => void {
    this.fsWriteListeners.add(fn);
    return () => {
      this.fsWriteListeners.delete(fn);
    };
  }

  private notifyFsWrite(absPath: string, bytes: number): void {
    for (const fn of this.fsWriteListeners) {
      try {
        fn(absPath, bytes);
      } catch (err) {
        console.error("ACP fs write listener failed", err);
      }
    }
  }

  private processLive(): boolean {
    return Boolean(this.ws && this.initialized && this.ws.readyState === WebSocket.OPEN);
  }

  hasLoaded(acpId: string): boolean {
    if (!acpId || !this.processLive()) return false;
    return this.loadedSessions.has(acpId);
  }

  private markLoaded(acpId: string): void {
    if (acpId) this.loadedSessions.add(acpId);
  }

  private forgetLoaded(): void {
    this.loadedSessions.clear();
    this.sessionSandboxes.clear();
  }

  bindSandbox(acpId: string, sandbox: string): void {
    if (acpId && sandbox) this.sessionSandboxes.set(acpId, sandbox);
  }

  private acpSessionIdFromParams(params: unknown): string {
    if (!params || typeof params !== "object") return "";
    const o = params as Record<string, unknown>;
    if (typeof o.sessionId === "string" && o.sessionId.trim()) return o.sessionId.trim();
    const meta = o._meta;
    if (meta && typeof meta === "object") {
      const m = meta as Record<string, unknown>;
      if (typeof m.sessionId === "string" && m.sessionId.trim()) return m.sessionId.trim();
    }
    return "";
  }

  private sandboxFor(params: unknown): string | null {
    const sid = this.acpSessionIdFromParams(params);
    if (sid) return this.sessionSandboxes.get(sid) ?? null;
    // Grok sometimes omits sessionId on fs/terminal. Only guess when a single
    // prompt is in flight so two concurrent turns cannot mix sandboxes.
    if (this.promptWaiters.size === 1) {
      const only = this.promptWaiters.keys().next().value;
      if (typeof only === "string") return this.sessionSandboxes.get(only) ?? null;
    }
    return null;
  }

  private jailOrError(id: number | string, params: unknown, candidate: string, label: string): string | null {
    const sandbox = this.sandboxFor(params);
    if (!sandbox) {
      this.respondError(id, -32000, "no sandbox for ACP session");
      return null;
    }
    const jailed = jailSessionPath(sandbox, candidate);
    if (!jailed) {
      this.respondError(id, -32602, `${label} outside session sandbox`);
      return null;
    }
    return jailed;
  }

  async ensureProcess(): Promise<void> {
    if (this.processLive()) return;
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      await this.starting;
      this.backoffMs = 250;
    } catch (err) {
      throw err;
    } finally {
      this.starting = null;
      if (!this.processLive()) this.scheduleReconnect();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.starting || this.reconnectTimer || this.processLive()) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureProcess().catch((err) => {
        console.error("[acp] websocket reconnect failed", err);
      });
    }, wait);
  }

  private frameText(data: WebSocket.RawData): string {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    return Buffer.from(data).toString("utf8");
  }

  private async boot(): Promise<void> {
    this.clearReconnectTimer();
    this.teardown(new Error("ACP reconnect"));
    const url = grokAcpWsUrl();
    const secret = grokAgentSecret();
    const headers: Record<string, string> = {};
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const sock = new WebSocket(url, { headers });
    this.ws = sock;
    this.buf = "";
    this.initialized = false;
    this.forgetLoaded();
    sock.on("message", (data, isBinary) => {
      if (this.ws !== sock) return;
      if (isBinary) return;
      this.onFrame(this.frameText(data));
    });
    sock.on("error", (err) => {
      if (this.ws !== sock) return;
      console.error("[acp] websocket error", err);
    });
    sock.on("close", () => {
      if (this.ws !== sock) return;
      this.ws = null;
      this.initialized = false;
      this.forgetLoaded();
      this.failAll(new Error("ACP websocket closed"));
      this.scheduleReconnect();
    });
    await new Promise<void>((resolve, reject) => {
      if (sock.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const onOpen = () => {
        sock.off("open", onOpen);
        sock.off("error", onErr);
        resolve();
      };
      const onErr = (err: Error) => {
        sock.off("open", onOpen);
        sock.off("error", onErr);
        reject(err);
      };
      sock.on("open", onOpen);
      sock.on("error", onErr);
    });
    await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "buildinator", version: "1.0.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this.initialized = true;
  }

  private teardown(reason: Error): void {
    this.failAll(reason);
    const ws = this.ws;
    this.ws = null;
    this.initialized = false;
    this.buf = "";
    this.updateHandlers.clear();
    for (const t of this.terminals.values()) {
      try {
        t.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.terminals.clear();
    this.forgetLoaded();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  private failAll(err: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(err);
  }

  private onFrame(chunk: string): void {
    const text = chunk.replace(/^\uFEFF/, "");
    if (!text) return;
    try {
      this.onMessage(JSON.parse(text) as Record<string, unknown>);
      this.buf = "";
      return;
    } catch {
      // one JSON per frame is normal; also tolerate newline-concatenated frames
    }
    this.buf += text;
    if (this.buf.includes("\n")) {
      this.drainNewlineFrames();
      return;
    }
    try {
      this.onMessage(JSON.parse(this.buf) as Record<string, unknown>);
      this.buf = "";
    } catch {
      if (this.buf.length > 4_000_000) this.buf = "";
    }
  }

  private drainNewlineFrames(): void {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        this.onMessage(JSON.parse(line) as Record<string, unknown>);
      } catch {
        continue;
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    const id = msg.id;
    const method = typeof msg.method === "string" ? msg.method : null;
    if (method && id !== undefined) {
      void this.handleAgentRequest(id as number | string, method, msg.params);
      return;
    }
    if (method) {
      this.handleNotification(method, msg.params);
      return;
    }
    if (typeof id === "number") {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (msg.error) {
        const err = msg.error as { message?: unknown; code?: unknown };
        const code = typeof err.code === "number" ? err.code : undefined;
        p.reject(
          new AcpError(
            typeof err.message === "string"
              ? err.message
              : `ACP error ${err.code ?? ""}`.trim(),
            code,
          ),
        );
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    if (!params || typeof params !== "object") return;
    const body = params as { sessionId?: unknown; update?: unknown };
    if (typeof body.sessionId !== "string" || !body.update || typeof body.update !== "object") {
      return;
    }
    const update = body.update as AcpUpdate;
    if (typeof update.sessionUpdate !== "string") return;
    try {
      this.updateHandlers.get(body.sessionId)?.(update);
    } catch (err) {
      console.error("ACP session/update handler failed", err);
    }
  }

  private handleAgentRequest(id: number | string, method: string, params: unknown): void {
    try {
      if (method === "session/request_permission") {
        this.respondPermission(id, params);
        return;
      }
      if (method === "fs/read_text_file") {
        this.respondFsRead(id, params);
        return;
      }
      if (method === "fs/write_text_file") {
        this.respondFsWrite(id, params);
        return;
      }
      if (method === "terminal/create") {
        this.respondTermCreate(id, params);
        return;
      }
      if (method === "terminal/output") {
        this.respondTermOutput(id, params);
        return;
      }
      if (method === "terminal/wait_for_exit") {
        void this.respondTermWait(id, params);
        return;
      }
      if (method === "terminal/kill") {
        this.respondTermKill(id, params);
        return;
      }
      if (method === "terminal/release") {
        this.respondTermRelease(id, params);
        return;
      }
      this.respondError(id, -32601, `Method not found: ${method}`);
    } catch (err) {
      this.respondError(id, -32000, err instanceof Error ? err.message : "request failed");
    }
  }

  private write(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private respondPermission(id: number | string, params: unknown): void {
    const options =
      params && typeof params === "object" && Array.isArray((params as { options?: unknown }).options)
        ? ((params as { options: Array<{ optionId?: unknown; kind?: unknown }> }).options)
        : [];
    const preferred =
      options.find((o) => o.kind === "allow_always") ??
      options.find((o) => o.kind === "allow_once") ??
      options[0];
    const optionId =
      preferred && typeof preferred.optionId === "string" ? preferred.optionId : "allow-once";
    this.respond(id, { outcome: { outcome: "selected", optionId } });
  }

  private respondFsRead(id: number | string, params: unknown): void {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (typeof p.path !== "string" || !p.path) {
      this.respondError(id, -32602, "path required");
      return;
    }
    const abs = this.jailOrError(id, params, p.path, "path");
    if (!abs) return;
    try {
      let content = fs.readFileSync(abs, "utf8");
      const line = typeof p.line === "number" ? p.line : undefined;
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      if (line != null || limit != null) {
        const lines = content.split("\n");
        const start = line && line > 0 ? line - 1 : 0;
        const end = limit != null ? start + limit : lines.length;
        content = lines.slice(start, end).join("\n");
      }
      this.respond(id, { content });
    } catch (err) {
      this.respondError(id, -32000, err instanceof Error ? err.message : "read failed");
    }
  }

  private respondFsWrite(id: number | string, params: unknown): void {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (typeof p.path !== "string" || !p.path) {
      this.respondError(id, -32602, "path required");
      return;
    }
    if (typeof p.content !== "string") {
      this.respondError(id, -32602, "content required");
      return;
    }
    const abs = this.jailOrError(id, params, p.path, "path");
    if (!abs) return;
    try {
      fs.writeFileSync(abs, p.content, "utf8");
      this.respond(id, {});
      const bytes = Buffer.byteLength(p.content, "utf8");
      this.notifyFsWrite(abs, bytes);
    } catch (err) {
      this.respondError(id, -32000, err instanceof Error ? err.message : "write failed");
    }
  }

  private respondTermCreate(id: number | string, params: unknown): void {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (typeof p.command !== "string" || !p.command) {
      this.respondError(id, -32602, "command required");
      return;
    }
    const args = Array.isArray(p.args) ? p.args.map((a) => String(a)) : [];
    const sandbox = this.sandboxFor(params);
    if (!sandbox) {
      this.respondError(id, -32000, "no sandbox for ACP session");
      return;
    }
    const rawCwd = typeof p.cwd === "string" && p.cwd.trim() ? p.cwd : sandbox;
    const cwd = jailSessionPath(sandbox, rawCwd);
    if (!cwd) {
      this.respondError(id, -32602, "cwd outside session sandbox");
      return;
    }
    const extraEnv: Record<string, string> = {};
    if (Array.isArray(p.env)) {
      for (const item of p.env) {
        if (item && typeof item === "object") {
          const e = item as { name?: unknown; value?: unknown };
          if (typeof e.name === "string") extraEnv[e.name] = String(e.value ?? "");
        }
      }
    }
    const { home, grokHome, path } = grokPaths();
    const child = spawn(p.command, args, {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        GROK_HOME: grokHome,
        PATH: path,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const term: Term = {
      child,
      output: "",
      limit: typeof p.outputByteLimit === "number" ? p.outputByteLimit : 1_000_000,
      exitCode: null,
      signal: null,
      waiters: [],
    };
    const onChunk = (chunk: Buffer) => {
      term.output += chunk.toString("utf8");
      if (term.output.length > term.limit) {
        term.output = term.output.slice(term.output.length - term.limit);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("close", (code, signal) => {
      term.exitCode = code;
      term.signal = signal;
      const waiters = term.waiters.splice(0);
      for (const w of waiters) w({ exitCode: code, signal });
    });
    const terminalId = newId();
    this.terminals.set(terminalId, term);
    this.respond(id, { terminalId });
  }

  private respondTermOutput(id: number | string, params: unknown): void {
    const term = this.termFrom(params);
    if (!term) {
      this.respondError(id, -32602, "unknown terminal");
      return;
    }
    this.respond(id, {
      output: term.output,
      truncated: term.output.length >= term.limit,
      exitStatus:
        term.exitCode !== null || term.signal
          ? { exitCode: term.exitCode, signal: term.signal }
          : null,
    });
  }

  private async respondTermWait(id: number | string, params: unknown): Promise<void> {
    const term = this.termFrom(params);
    if (!term) {
      this.respondError(id, -32602, "unknown terminal");
      return;
    }
    if (term.exitCode !== null || term.signal) {
      this.respond(id, { exitCode: term.exitCode, signal: term.signal });
      return;
    }
    const status = await new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
      term.waiters.push(resolve);
    });
    this.respond(id, status);
  }

  private respondTermKill(id: number | string, params: unknown): void {
    const term = this.termFrom(params);
    if (!term) {
      this.respondError(id, -32602, "unknown terminal");
      return;
    }
    try {
      term.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.respond(id, {});
  }

  private respondTermRelease(id: number | string, params: unknown): void {
    const p = params && typeof params === "object" ? (params as { terminalId?: unknown }) : {};
    const terminalId = typeof p.terminalId === "string" ? p.terminalId : "";
    const term = this.terminals.get(terminalId);
    if (term) {
      try {
        term.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.terminals.delete(terminalId);
    }
    this.respond(id, {});
  }

  private termFrom(params: unknown): Term | undefined {
    const terminalId =
      params && typeof params === "object" && typeof (params as { terminalId?: unknown }).terminalId === "string"
        ? (params as { terminalId: string }).terminalId
        : "";
    return this.terminals.get(terminalId);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return this.requestWithId(this.nextId++, method, params);
  }

  private requestWithId(id: number, method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("ACP websocket is not open"));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async sessionNew(cwd: string, approval = "always-approve"): Promise<string> {
    await this.ensureProcess();
    const meta = sessionNewMeta(approval);
    const result = await this.request("session/new", {
      cwd,
      mcpServers: [],
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    });
    const sessionId =
      result && typeof result === "object" && typeof (result as { sessionId?: unknown }).sessionId === "string"
        ? (result as { sessionId: string }).sessionId
        : "";
    if (!sessionId) throw new Error("session/new missing sessionId");
    this.markLoaded(sessionId);
    this.bindSandbox(sessionId, cwd);
    return sessionId;
  }

  async sessionLoad(acpId: string, cwd?: string): Promise<void> {
    await this.ensureProcess();
    if (cwd) this.bindSandbox(acpId, cwd);
    if (this.hasLoaded(acpId)) return;
    try {
      await this.request("session/load", { sessionId: acpId });
      this.markLoaded(acpId);
      if (cwd) this.bindSandbox(acpId, cwd);
    } catch (err) {
      if (isAlreadyLoadedError(err)) {
        this.markLoaded(acpId);
        if (cwd) this.bindSandbox(acpId, cwd);
        return;
      }
      // Do not close the ACP websocket on a failed load.
      throw err;
    }
  }

  async sessionPrompt(
    acpId: string,
    text: string,
    onUpdate: (update: AcpUpdate) => void,
  ): Promise<{ stopReason?: string }> {
    await this.ensureProcess();
    const handler = (update: AcpUpdate) => {
      try {
        onUpdate(update);
      } catch (err) {
        console.error("ACP onUpdate failed", err);
      }
    };
    this.updateHandlers.set(acpId, handler);
    const id = this.nextId++;
    this.promptWaiters.set(acpId, id);
    try {
      const result = await this.requestWithId(id, "session/prompt", {
        sessionId: acpId,
        prompt: [{ type: "text", text }],
      });
      const stopReason =
        result && typeof result === "object" && (result as { stopReason?: unknown }).stopReason != null
          ? String((result as { stopReason: unknown }).stopReason)
          : undefined;
      return { stopReason };
    } finally {
      if (this.promptWaiters.get(acpId) === id) this.promptWaiters.delete(acpId);
      if (this.updateHandlers.get(acpId) === handler) this.updateHandlers.delete(acpId);
    }
  }

  sessionCancel(acpId: string): void {
    this.write({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpId } });
    const id = this.promptWaiters.get(acpId);
    if (id == null) return;
    // Notification has no RPC reply. grok usually completes session/prompt with
    // stopReason cancelled; if it ignores cancel, unstick the waiter so the
    // next queued turn is not deadlocked. Do not close the ACP websocket.
    setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      p.resolve({ stopReason: "cancelled" });
    }, 5000);
  }

  async sessionSetModel(sessionId: string, modelId: string): Promise<void> {
    await this.ensureProcess();
    await this.request("session/set_model", { sessionId, modelId });
  }

  async sessionSetMode(sessionId: string, modeId: string): Promise<void> {
    await this.ensureProcess();
    await this.request("session/set_mode", { sessionId, modeId });
  }

  async compactConversation(sessionId: string, context?: string): Promise<void> {
    await this.ensureProcess();
    const params: { sessionId: string; context?: string } = { sessionId };
    const note = context?.trim();
    if (note) params.context = note;
    try {
      await this.request("_x.ai/compact_conversation", params);
    } catch (err) {
      if (!isMethodNotFound(err)) throw err;
      await this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: compactSlashText(note) }],
      });
    }
  }

  async listRewindPoints(sessionId: string): Promise<RewindPoint[]> {
    await this.ensureProcess();
    const result = await this.request("_x.ai/rewind/points", { sessionId });
    return parseRewindPoints(result);
  }

  async rewindLastTurn(sessionId: string): Promise<void> {
    const tip = highestRewindPoint(await this.listRewindPoints(sessionId));
    if (!tip) throw new Error("No rewind points in grok session");
    await this.ensureProcess();
    const result = await this.request("_x.ai/rewind/execute", {
      sessionId,
      targetPromptIndex: tip.promptIndex,
      mode: "conversation_only",
      force: true,
    });
    const outcome = rewindExecuteSuccess(result);
    if (!outcome.success) {
      throw new Error(outcome.message || "grok rewind failed");
    }
  }
}

const globalForAcp = globalThis as unknown as { __buildinatorAcp?: AcpClient };

export function getAcpClient(): AcpClient {
  if (!globalForAcp.__buildinatorAcp) {
    globalForAcp.__buildinatorAcp = new AcpClient();
  }
  return globalForAcp.__buildinatorAcp;
}
