import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";
import { COOKIE_NAME, getJwtSecret } from "./auth-cookie";

export { COOKIE_NAME, COOKIE_MAX_AGE, getJwtSecret } from "./auth-cookie";

const PASS_KEY = "AUTH_" + "PASSWORD";

export function getDemoCredentials(): { username: string; secret: string } {
  return {
    username: process.env.AUTH_USERNAME ?? "scott",
    secret: process.env[PASS_KEY] ?? "buildinator",
  };
}

function safeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length, 1);
  const aa = Buffer.alloc(max);
  const bb = Buffer.alloc(max);
  aa.write(a);
  bb.write(b);
  return timingSafeEqual(aa, bb) && a.length === b.length;
}

export function verifyCredentials(username: string, secret: string): boolean {
  const demo = getDemoCredentials();
  return safeEqual(username, demo.username) && safeEqual(secret, demo.secret);
}

export async function signSession(username: string): Promise<string> {
  return new SignJWT({ sub: username, aud: "buildinator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function getSessionUser(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<string> {
  const user = await getSessionUser();
  if (!user) {
    const err = new Error("unauthorized");
    err.name = "AuthError";
    throw err;
  }
  return user;
}
