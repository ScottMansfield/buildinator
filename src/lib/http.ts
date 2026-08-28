import { NextResponse } from "next/server";
import { AclError, NotFoundError } from "./errors";

export function jsonError(err: unknown, fallback = 400): NextResponse {
  if (err instanceof AclError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  const message = err instanceof Error ? err.message : "failed";
  const status =
    message === "unauthorized"
      ? 401
      : message.includes("not found") || message.includes("unknown")
        ? 404
        : fallback;
  return NextResponse.json({ error: message }, { status });
}
