export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function projectName(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${rounded}K`;
  }
  return String(n);
}

export function contextMeter(input = 0, output = 0, cap = 500_000): string {
  const used = input + output;
  return `${formatTokens(used)} / ${formatTokens(cap)}`;
}

export function prettyModel(model: string): string {
  return model.replace(/^grok-/i, "Grok ");
}

export function modelStatusLine(
  model: string,
  variant: string,
  approval = "always-approve",
): string {
  return `${prettyModel(model)} (${variant}) · ${approval}`;
}

export function isUntitled(title: string): boolean {
  return !title.trim() || /^new session$/i.test(title.trim());
}

/** Short sidebar name from the first prompt. Heuristic only; no ellipsis stored. */
const TITLE_FILLER =
  /^(?:(?:please|hey|hi|hello|yo)[,!]?\s+|(?:can|could|would|will)\s+you(?:\s+please)?\s+|help\s+me(?:\s+to)?\s+|i(?:['’]d|\s+would)\s+like\s+(?:you\s+to\s+)?|i\s+(?:want|need)(?:\s+you\s+to)?\s+)/i;

const TITLE_VERB =
  /^(?:(?:check|look\s+at|show|get|find)(?:\s+me)?|tell\s+me)\s+(?:the\s+current\s+)?/i;

export function titleFromPrompt(prompt: string): string {
  const line =
    prompt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !/^\/\w+(?:\s|$)/.test(s)) ?? "";
  let cleaned = line
    .replace(/^#+\s*/, "")
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 4; i++) {
    const next = cleaned.replace(TITLE_FILLER, "").replace(TITLE_VERB, "").trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  const clause = (cleaned.split(/[.!?;]/)[0] ?? cleaned).trim() || cleaned;
  const source = clause.replace(/[,:]+$/g, "").trim();
  if (!source) return "";
  const max = 36;
  if (source.length <= max) return source;
  const cut = source.slice(0, max);
  if (source[max] === " ") return cut.trim();
  const sp = cut.lastIndexOf(" ");
  return (sp > 16 ? cut.slice(0, sp) : cut).trim();
}

/** Chat elapsed durations: 4.2s, 12s, 7m 38s, 1h 2m. Never 458s. */
export function formatElapsed(ms: number): string {
  const n = Math.max(0, ms);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}s`;
  const total = Math.round(n / 1000);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Last-event age: `updated 2s ago`, `updated 1m 30s ago`. */
export function formatUpdatedAgo(ms: number): string {
  const n = Math.max(0, ms);
  const s = Math.round(n / 1000);
  if (s <= 0) return "updated just now";
  if (s < 60) return `updated ${s}s ago`;
  return `updated ${formatElapsed(s * 1000)} ago`;
}

/** Human file size for artifact.content, e.g. `12 KB`. */
export function formatBytes(bytes: number): string {
  const n = Math.max(0, Math.round(Number(bytes) || 0));
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${rounded} MB`;
  }
  const gb = n / (1024 * 1024 * 1024);
  const rounded = gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10;
  return `${rounded} GB`;
}
