import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { COOKIE_NAME, getJwtSecret } from "./auth-cookie";
import { parseUserRole } from "./acl";
import { findUserById, findUserByUsername } from "./db";
import { verifyPassword } from "./passwords";
import type { SessionUser } from "./types";

export { COOKIE_NAME, COOKIE_MAX_AGE, getJwtSecret } from "./auth-cookie";

function toSessionUser(row: {
  id: string;
  username: string;
  role: string;
  disabled: number;
}): SessionUser | null {
  if (row.disabled) return null;
  return {
    id: row.id,
    username: row.username,
    role: parseUserRole(row.role),
  };
}

export async function authenticate(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const row = findUserByUsername(username);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return toSessionUser(row);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: user.id, username: user.username, aud: "buildinator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const id = typeof payload.sub === "string" ? payload.sub : null;
    if (!id) return null;
    const byId = findUserById(id);
    if (byId) return toSessionUser(byId);
    const username =
      typeof payload.username === "string" ? payload.username : null;
    if (username) {
      const byName = findUserByUsername(username);
      if (byName) return toSessionUser(byName);
    }
    const byNameAsId = findUserByUsername(id);
    if (byNameAsId) return toSessionUser(byNameAsId);
    return null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const err = new Error("unauthorized");
    err.name = "AuthError";
    throw err;
  }
  return user;
}
