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
