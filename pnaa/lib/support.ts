/**
 * Contact details for the chapter dashboard's Help & Support box.
 *
 * These are placeholders until PNAA confirms the real help-desk address and
 * number — set the NEXT_PUBLIC_SUPPORT_* env vars to override per environment
 * so the national office can change who fields chapter questions without a
 * code change. Any field left blank is simply omitted from the card.
 */
export const SUPPORT_CONTACT = {
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@mypnaa.org",
  phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "",
  /** Free text, e.g. "Monday–Friday, 9am–5pm ET". */
  hours: process.env.NEXT_PUBLIC_SUPPORT_HOURS ?? "Monday–Friday, 9am–5pm ET",
} as const;

/** Digits only — what a tel: href needs. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
