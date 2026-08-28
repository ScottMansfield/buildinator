import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";

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
