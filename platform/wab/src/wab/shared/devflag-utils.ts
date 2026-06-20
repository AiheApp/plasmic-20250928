import { DevFlagsType } from "@/wab/shared/devflags";

export function isAdminTeamEmail(
  email: string | undefined | null,
  devflags: DevFlagsType
): boolean {
  if (!email) {
    return false;
  }
  // Per-email allowlist takes precedence over the domain match, so a self-hosted
  // instance can grant admin-team status to specific accounts without making the
  // entire email domain admin (e.g. adminTeamDomain left at its default).
  if ((devflags.adminTeamEmails ?? []).includes(email)) {
    return true;
  }
  // Support more than one admin-team domain (a self-hosted instance may own
  // several, e.g. aihe.me + aihe.dev). Falls back to the single adminTeamDomain
  // for backward compatibility.
  if (
    ((devflags as { adminTeamDomains?: string[] }).adminTeamDomains ?? []).some(
      (domain) => email.endsWith("@" + domain)
    )
  ) {
    return true;
  }
  return email.endsWith("@" + devflags.adminTeamDomain);
}

export function isGoogleAuthRequiredEmailDomain(
  email: string,
  devflags: DevFlagsType
): boolean {
  return !!devflags.googleAuthRequiredEmailDomains.find((dom) =>
    email.endsWith("@" + dom)
  );
}
