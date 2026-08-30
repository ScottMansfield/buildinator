import { NextResponse } from "next/server";

const FAIL_DELAY_MS = 1000;
const LOCKOUT_DELAY_MS = 4000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_IN_FLIGHT_DELAYS = 20;

const failures = new Map<string, number[]>();
let inFlightDelays = 0;

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const nextReq = request as Request & { ip?: string | null };
  if (typeof nextReq.ip === "string" && nextReq.ip) return nextReq.ip;
  return "unknown";
}

export function attemptKey(username: string, ip: string): string {
  return `${username.toLowerCase()}|${ip}`;
}

function prune(at: number[], now: number): number[] {
  return at.filter((t) => now - t < WINDOW_MS);
}

export function isLockedOut(key: string): boolean {
  const now = Date.now();
  const at = failures.get(key);
  if (!at) return false;
  const kept = prune(at, now);
  if (kept.length === 0) {
    failures.delete(key);
    return false;
  }
  failures.set(key, kept);
  return kept.length >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const kept = prune(failures.get(key) ?? [], now);
  kept.push(now);
  failures.set(key, kept);
}

export function resetFailures(key: string): void {
  failures.delete(key);
}

export async function delayLogin(ms: number): Promise<boolean> {
  if (inFlightDelays >= MAX_IN_FLIGHT_DELAYS) return false;
  inFlightDelays += 1;
  try {
    await new Promise((r) => setTimeout(r, ms));
    return true;
  } finally {
    inFlightDelays -= 1;
  }
}

export async function delayFailedLogin(startedAt: number): Promise<boolean> {
  const remaining = FAIL_DELAY_MS - (Date.now() - startedAt);
  if (remaining <= 0) return true;
  return delayLogin(remaining);
}

export async function delayLockout(): Promise<boolean> {
  return delayLogin(LOCKOUT_DELAY_MS);
}

export function tooManyResponse(): NextResponse {
  return NextResponse.json(
    { error: "too many attempts", retry: 5 },
    { status: 429, headers: { "Retry-After": "5" } },
  );
}
