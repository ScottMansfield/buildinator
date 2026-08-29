import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const adapter = getAdapter();
  const [projects, owned] = await Promise.all([
    adapter.listProjects(user),
    adapter.listOwnedProjects(user),
  ]);
  return NextResponse.json({ projects, owned });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  try {
    const project = await getAdapter().createProject(user, body.name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
