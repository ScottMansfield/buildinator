import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  const adapter = getAdapter();
  const sessions = await adapter.listSessions(projectId);
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { projectId?: unknown; title?: unknown };
  try {
    body = (await request.json()) as { projectId?: unknown; title?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.projectId !== "string" || !body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : undefined;
  try {
    const session = await getAdapter().createSession(body.projectId, title);
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
