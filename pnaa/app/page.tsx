import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function Home() {
  const cookieStore = await cookies();
  // Mirror middleware.ts: a Supabase session is held in `sb-*` cookies. A stale
  // cookie still routes to /dashboard, where middleware re-validates the session
  // and bounces back to /signin if it's no longer good.
  const hasSupabaseCookie = cookieStore
    .getAll()
    .some((c) => c.name.startsWith("sb-"));

  if (hasSupabaseCookie) {
    redirect("/dashboard");
  } else {
    redirect("/signin");
  }
}
