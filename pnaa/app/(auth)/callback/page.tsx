// The OAuth callback API route now establishes the session server-side via
// cookies and redirects directly to /dashboard or /setup. If anything still
// lands on /callback (e.g. an old bookmarked URL), forward to /dashboard.

import { redirect } from "next/navigation";

export default function CallbackPage() {
  redirect("/dashboard");
}
