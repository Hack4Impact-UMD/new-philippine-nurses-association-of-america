import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await supabaseRoute();
  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
