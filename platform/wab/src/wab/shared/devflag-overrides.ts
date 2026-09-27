import type { DevFlagsType } from "@/wab/shared/devflags";

export const DEFAULT_DEVFLAG_OVERRIDES: Partial<DevFlagsType> = {
  // Plasmic Hosting (Plasmic serving published sites itself) is unused here:
  // production sites live in the team's own Next.js/React apps on aihe.me and
  // consume projects via the loader (host: https://studio.aihe.dev). Keeping
  // the hosting tab enabled would surface dead URLs built from the stale
  // plasmicHostingSubdomainSuffix (plasmic.157.90.224.29.sslip.io). Disable it
  // so the publish flow only offers the paths that actually work. Loader and
  // codegen are unaffected by this flag.
  enablePlasmicHosting: false,
  showCopilot: true,
  // Origins Studio trusts to embed as the canvas/app host. Must include the
  // canvas host origin or the canvas iframe is rejected. (Previously hardcoded
  // to the sample's http://157.90.224.29:3005, which also caused mixed-content
  // since Studio is served over HTTPS.)
  globalTrustedHosts: ["https://canvas.aihe.dev", "https://studio.aihe.dev"],
  defaultHostUrl: "https://canvas.aihe.dev",
  // Internal tool: only these email domains may create accounts (password or
  // OAuth). Everyone else is rejected at signup; existing users still log in.
  allowedSignupEmailDomains: ["aihe.me", "aihe.dev"],
};
