export const COOKIE_NAME = "buildinator_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function getJwtSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ?? "dev-only-change-me-please-use-32b!!";
  return new TextEncoder().encode(secret);
}
