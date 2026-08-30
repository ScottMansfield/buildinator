import { NextResponse } from "next/server";
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  authenticate,
  signSession,
} from "@/lib/auth";
import {
  attemptKey,
  clientIp,
  delayFailedLogin,
  delayLockout,
  isLockedOut,
  recordFailure,
  resetFailures,
  tooManyResponse,
} from "@/lib/login-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "missing credentials" }, { status: 400 });
  }

  const startedAt = Date.now();
  const key = attemptKey(username, clientIp(request));

  if (isLockedOut(key)) {
    const delayed = await delayLockout();
    if (!delayed) return tooManyResponse();
    return tooManyResponse();
  }

  const user = await authenticate(username, password);
  if (!user) {
    recordFailure(key);
    const delayed = await delayFailedLogin(startedAt);
    if (!delayed) return tooManyResponse();
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  resetFailures(key);
  const token = await signSession(user);
  const res = NextResponse.json({
    ok: true,
    username: user.username,
    id: user.id,
    role: user.role,
  });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
