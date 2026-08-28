import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default async function AppPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AppShell username={user} />;
}
