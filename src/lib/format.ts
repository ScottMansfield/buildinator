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
