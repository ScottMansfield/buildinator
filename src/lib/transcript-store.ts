import fs from "node:fs";
import path from "node:path";
import { dataRoot } from "./sandbox";
import type { Transcript } from "./seed-transcripts";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function transcriptsDir(): string {
  return path.join(dataRoot(), "transcripts");
}

function transcriptPath(id: string): string {
  if (!SAFE_ID.test(id)) {
    throw new Error("invalid sessionId");
  }
  const root = path.resolve(transcriptsDir());
  const file = path.resolve(root, `${id}.json`);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (file !== root && !file.startsWith(prefix)) {
    throw new Error("transcript path escape");
  }
  return file;
}

function isTranscript(value: unknown): value is Transcript {
  if (!value || typeof value !== "object") return false;
  const t = value as Transcript;
  return Array.isArray(t.messages) && Array.isArray(t.toolCalls) && Array.isArray(t.artifacts);
}

export function loadTranscript(id: string): Transcript | null {
  if (!SAFE_ID.test(id)) return null;
  try {
    const raw = fs.readFileSync(transcriptPath(id), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isTranscript(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTranscript(id: string, t: Transcript): void {
  const dir = transcriptsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(transcriptPath(id), JSON.stringify(t), "utf8");
}

export function deleteTranscript(id: string): void {
  if (!SAFE_ID.test(id)) return;
  try {
    fs.unlinkSync(transcriptPath(id));
  } catch {
    // missing file is fine
  }
}
