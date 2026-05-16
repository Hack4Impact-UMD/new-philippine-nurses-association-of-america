import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { exchangeCodeForToken, getContactInfo } from "@/lib/wild-apricot/oauth";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Wild Apricot OAuth callback → Supabase session.
 *
 * Instead of minting our own HS256 JWT with the legacy SUPABASE_JWT_SECRET,
 * we use the canonical "trusted third-party OAuth" pattern:
 *
 *   1. Validate WA state, exchange code, fetch the user's WA contact.
 *   2. Find or create the auth.users row via the Admin API.
 *   3. Upsert public.users and write app_metadata (user_role / chapter_name / region).
 *   4. Generate a one-shot magic-link token_hash via admin.generateLink.
 *   5. Redeem it server-side with auth.verifyOtp on a cookie-bound client —
 *      this writes the sb-access-token / sb-refresh-token cookies for us.
 *
 * This works with the new asymmetric-JWT signing keys when they roll out
 * because we never touch the JWT secret ourselves.
 */
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
    // 1. Exchange WA code → access token → contact info
    const { access_token } = await exchangeCodeForToken(code);
    const contact = await getContactInfo(access_token);
    const email = contact.Email;
    const displayName = `${contact.FirstName} ${contact.LastName}`.trim();

    // 2. Find or create the auth.users row.
    const admin = supabaseAdmin();
    let authUserId: string | undefined;

    const { data: existingByEmail } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const found = existingByEmail.users.find(
      (u: { id: string; email?: string | null }) =>
        u.email?.toLowerCase() === email.toLowerCase()
    );
    if (found) {
      authUserId = found.id;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { displayName },
      });
      if (createErr) throw createErr;
      authUserId = created.user?.id;
    }
    if (!authUserId) throw new Error("Could not resolve auth user");

    // 3. Upsert the public.users profile and read the persisted role.
    const { data: existing } = await admin
      .from("users")
      .select("role, chapterId, region")
      .eq("id", authUserId)
      .maybeSingle();

    const isNewUser = !existing;
    const role: string =
      (existing as { role?: string } | null)?.role ?? "member";
    const chapterId: string | null =
      (existing as { chapterId?: string } | null)?.chapterId ?? null;
    const region: string | null =
      (existing as { region?: string } | null)?.region ?? null;

    if (isNewUser) {
      const { error: insErr } = await admin.from("users").insert({
        id: authUserId,
        email,
        displayName,
        role: "member",
        waContactId: String(contact.Id),
        needsOnboarding: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
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

    // 4. Mirror role/chapter/region into auth.users.app_metadata so the
    //    Supabase-issued JWT carries them and RLS works.
    await admin.auth.admin.updateUserById(authUserId, {
      app_metadata: {
        user_role: role,
        ...(chapterId ? { chapter_id: chapterId } : {}),
        ...(region ? { region } : {}),
      },
    });

    // 5. Get a one-shot magic-link token for this user.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;
    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) throw new Error("generateLink returned no token_hash");

    // 6. Redeem the token on a cookie-bound client so the sb-* cookies are
    //    written to our redirect response.
    const response = NextResponse.redirect(
      isNewUser ? `${appUrl}/setup` : `${appUrl}/dashboard`
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
