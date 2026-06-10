import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { exchangeCodeForToken, getContactInfo } from "@/lib/wild-apricot/oauth";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Wild Apricot OAuth callback → Supabase session.
 *
 * Flow:
 *   1. Validate WA state, exchange code, fetch the user's WA contact.
 *   2. Find-or-create auth.users by email (paginated lookup).
 *   3. Upsert public.users; new rows get needsOnboarding = true.
 *   4. Merge user_role / chapter_id / region into auth.users.app_metadata
 *      so the JWT carries them for RLS.
 *   5. Generate + redeem a magic-link token_hash to set sb-* cookies.
 */
/** Paginated scan of auth.users by email. Fallback only — O(all users). */
async function findAuthUserByEmail(
  admin: ReturnType<typeof supabaseAdmin>,
  emailLower: string
): Promise<string | undefined> {
  const LIST_PER_PAGE = 1000;
  for (let page = 1; ; page++) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PER_PAGE,
    });
    if (listErr) throw listErr;
    const match = data.users.find(
      (u: { id: string; email?: string | null }) =>
        u.email?.toLowerCase() === emailLower
    );
    if (match) return match.id;
    if (data.users.length < LIST_PER_PAGE) return undefined;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/signin?error=missing_params`);
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("wa_oauth_state")?.value;
  if (state !== storedState) {
    return NextResponse.redirect(`${appUrl}/signin?error=invalid_state`);
  }
  cookieStore.delete("wa_oauth_state");

  try {
    const { access_token } = await exchangeCodeForToken(code);
    const contact = await getContactInfo(access_token);
    const email = contact.Email;
    if (!email) {
      throw new Error("Wild Apricot contact has no email address");
    }
    const displayName = `${contact.FirstName} ${contact.LastName}`.trim();
    const emailLower = email.toLowerCase();

    const admin = supabaseAdmin();

    // Find the existing user via public.users (mirrors auth emails: trigger on
    // signup + update on every login). One indexed lookup instead of paging
    // the entire auth user list on every sign-in. ilike with wildcards escaped
    // = case-insensitive equality.
    const emailPattern = emailLower.replace(/[\\%_]/g, (m) => `\\${m}`);
    let authUserId: string | undefined;
    const { data: mirrored } = await admin
      .from("users")
      .select("id")
      .ilike("email", emailPattern)
      .limit(1)
      .maybeSingle();
    authUserId = (mirrored as { id: string } | null)?.id;

    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { displayName },
      });
      if (createErr) {
        // The auth user exists but the public.users mirror missed it (stale
        // mirror, or a concurrent first login won the createUser race). Fall
        // back to scanning auth.users by email — cold path only.
        authUserId = await findAuthUserByEmail(admin, emailLower);
        if (!authUserId) throw createErr;
      } else {
        authUserId = created.user?.id;
      }
    }
    if (!authUserId) throw new Error("Could not resolve auth user");

    // (#2) Decide first-time setup from needsOnboarding, not from row presence.
    // The `on_auth_user_created` trigger creates the row immediately, so the
    // previous `isNewUser = !existing` check was structurally always false.
    const { data: existing } = await admin
      .from("users")
      .select("role, chapterId, region, needsOnboarding")
      .eq("id", authUserId)
      .maybeSingle();

    const needsOnboarding =
      (existing as { needsOnboarding?: boolean } | null)?.needsOnboarding ?? true;
    const role: string =
      (existing as { role?: string } | null)?.role ?? "member";
    const chapterId: string | null =
      (existing as { chapterId?: string } | null)?.chapterId ?? null;
    const region: string | null =
      (existing as { region?: string } | null)?.region ?? null;

    if (!existing) {
      // Trigger should have created this; fall back to an explicit insert in
      // case the trigger ever gets dropped.
      const { error: insErr } = await admin.from("users").insert({
        id: authUserId,
        email,
        displayName,
        role: "member",
        waContactId: String(contact.Id),
        needsOnboarding: true,
      });
      if (insErr) throw insErr;
    } else {
      await admin
        .from("users")
        .update({
          email,
          displayName,
          waContactId: String(contact.Id),
          lastLogin: new Date().toISOString(),
        })
        .eq("id", authUserId);
    }

    // (#7) Merge claims into existing app_metadata instead of replacing it.
    const { data: authUser } = await admin.auth.admin.getUserById(authUserId);
    const prevMeta = (authUser?.user?.app_metadata ?? {}) as Record<string, unknown>;
    await admin.auth.admin.updateUserById(authUserId, {
      app_metadata: {
        ...prevMeta,
        user_role: role,
        chapter_id: chapterId,
        region: region,
      },
    });

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;
    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) throw new Error("generateLink returned no token_hash");

    const response = NextResponse.redirect(
      needsOnboarding ? `${appUrl}/setup` : `${appUrl}/dashboard`
    );
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(
            cookiesToSet: { name: string; value: string; options?: CookieOptionsWithName }[]
          ) {
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      }
    );
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (verifyErr) throw verifyErr;

    return response;
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(`${appUrl}/signin?error=auth_failed`);
  }
}
