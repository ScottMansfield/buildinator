import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { grokPaths } from "./grok-cli";
import { newId } from "./ids";

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
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private starting: Promise<void> | null = null;
  private updateHandlers = new Map<string, (update: AcpUpdate) => void>();
  private terminals = new Map<string, Term>();

  async ensureProcess(): Promise<void> {
    if (this.child && this.initialized && this.child.exitCode === null && !this.child.killed) {
      return;
    }
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async boot(): Promise<void> {
    this.teardown(new Error("ACP respawn"));
    const { home, grokHome, bin, path } = grokPaths();
    const child = spawn(bin, ["agent", "--always-approve", "stdio"], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        GROK_HOME: grokHome,
        PATH: path,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.buf = "";
    this.initialized = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      const text = String(chunk).trim();
      if (text) console.error("[acp stderr]", text);
    });
    child.on("error", (err) => {
      this.failAll(err);
      this.initialized = false;
      this.child = null;
    });
    child.on("close", (code, signal) => {
      this.failAll(new Error(`grok ACP exited (${code ?? signal ?? "unknown"})`));
      this.initialized = false;
      if (this.child === child) this.child = null;
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
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.child = null;
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
  }

  private failAll(err: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(err);
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.onMessage(msg);
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
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(JSON.stringify(msg) + "\n");
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
    try {
      let content = fs.readFileSync(p.path, "utf8");
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
    try {
      fs.writeFileSync(p.path, p.content, "utf8");
      this.respond(id, {});
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
    const cwd = typeof p.cwd === "string" ? p.cwd : grokPaths().home;
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
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error("ACP process is not running"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        (err) => {
          if (err) {
            this.pending.delete(id);
            reject(err);
          }
        },
      );
    });
  }

  async sessionNew(cwd: string): Promise<string> {
    await this.ensureProcess();
    const result = await this.request("session/new", {
      cwd,
      mcpServers: [],
      _meta: { yoloMode: true },
    });
    const sessionId =
      result && typeof result === "object" && typeof (result as { sessionId?: unknown }).sessionId === "string"
        ? (result as { sessionId: string }).sessionId
        : "";
    if (!sessionId) throw new Error("session/new missing sessionId");
    return sessionId;
  }

  async sessionLoad(acpId: string): Promise<void> {
    await this.ensureProcess();
    await this.request("session/load", { sessionId: acpId });
  }

  async sessionPrompt(
    acpId: string,
    text: string,
    onUpdate: (update: AcpUpdate) => void,
  ): Promise<{ stopReason?: string }> {
    await this.ensureProcess();
    const prev = this.updateHandlers.get(acpId);
    this.updateHandlers.set(acpId, (update) => {
      try {
        onUpdate(update);
      } catch (err) {
        console.error("ACP onUpdate failed", err);
      }
      prev?.(update);
    });
    try {
      const result = await this.request("session/prompt", {
        sessionId: acpId,
        prompt: [{ type: "text", text }],
      });
      const stopReason =
        result && typeof result === "object" && (result as { stopReason?: unknown }).stopReason != null
          ? String((result as { stopReason: unknown }).stopReason)
          : undefined;
      return { stopReason };
    } finally {
      if (prev) this.updateHandlers.set(acpId, prev);
      else this.updateHandlers.delete(acpId);
    }
  }

  sessionCancel(acpId: string): void {
    this.write({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpId } });
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
