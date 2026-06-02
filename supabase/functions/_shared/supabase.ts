// Service-role Supabase client for Edge Functions.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function verifyWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get("WEBHOOK_SECRET");
  if (!expected) return false;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  return key === expected;
}
