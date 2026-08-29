import { getSessionUser } from "@/lib/auth";
import { requireRole } from "@/lib/acl";
import { getAccessibleSummary } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { subscribe } from "@/lib/session-events";
import type { SessionStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { id } = await ctx.params;
  try {
    const summary = getAccessibleSummary(user.id, id);
    if (!summary) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    requireRole(summary.myRole, "read");
  } catch (err) {
    return jsonError(err);
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsub: (() => void) | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const sendRaw = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const sendEvent = (event: SessionStreamEvent) => {
        sendRaw(`data: ${JSON.stringify(event)}\n\n`);
      };
      sendRaw("retry: 2000\n\n");
      sendRaw(": connected\n\n");
      unsub = subscribe(id, sendEvent);
      heartbeat = setInterval(() => sendRaw(": ping\n\n"), 15_000);
      const onAbort = () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsub?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    },
  });
}
