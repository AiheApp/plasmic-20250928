import { isAdminTeamEmail } from "@/wab/shared/devflag-utils";
import { DEVFLAGS, DevFlagsType } from "@/wab/shared/devflags";

describe("isAdminTeamEmail", () => {
  // Regression for the privilege-escalation fix: admin-team status (which grants
  // editor on every project via DbMgr.getActorAccessLevelToResources and any-project
  // collab via projects-socket) must be driven by the EXPLICIT adminTeamEmails
  // allowlist only. The previous default `adminTeamDomains: ["aihe.me","aihe.dev"]`
  // made every signup-eligible account admin-team (signup is invite-only restricted
  // to exactly those domains). These checks read the module-level DEVFLAGS singleton,
  // so a runtime override could not fix it — the default itself must be empty.

  it("does NOT grant admin-team by aihe.dev/aihe.me domain (the escalation)", () => {
    expect(isAdminTeamEmail("student@aihe.dev", DEVFLAGS)).toBe(false);
    expect(isAdminTeamEmail("teacher@aihe.me", DEVFLAGS)).toBe(false);
    expect(isAdminTeamEmail("random@aihe.dev", DEVFLAGS)).toBe(false);
  });

  it("grants admin-team only to the explicit adminTeamEmails allowlist", () => {
    expect(isAdminTeamEmail("salami@aihe.me", DEVFLAGS)).toBe(true);
    expect(isAdminTeamEmail("admin@aihe.me", DEVFLAGS)).toBe(true);
    expect(isAdminTeamEmail("claude@aihe.dev", DEVFLAGS)).toBe(true);
  });

  it("keeps adminTeamDomains empty so no domain confers admin-team", () => {
    expect(DEVFLAGS.adminTeamDomains).toEqual([]);
  });

  it("returns false for empty/nullish emails", () => {
    expect(isAdminTeamEmail(undefined, DEVFLAGS)).toBe(false);
    expect(isAdminTeamEmail(null, DEVFLAGS)).toBe(false);
    expect(isAdminTeamEmail("", DEVFLAGS)).toBe(false);
  });

  it("still honors an explicitly-configured adminTeamDomains (mechanism intact)", () => {
    const flags = { ...DEVFLAGS, adminTeamDomains: ["example.com"] } as DevFlagsType;
    expect(isAdminTeamEmail("someone@example.com", flags)).toBe(true);
    expect(isAdminTeamEmail("someone@aihe.dev", flags)).toBe(false);
  });
});
