import type { DevFlagsType } from "@/wab/shared/devflags";

export const DEFAULT_DEVFLAG_OVERRIDES: Partial<DevFlagsType> = {
  enablePlasmicHosting: true,
  showCopilot: true,
  // Origins Studio trusts to embed as the canvas/app host. Must include the
  // canvas host origin or the canvas iframe is rejected. (Previously hardcoded
  // to the sample's http://157.90.224.29:3005, which also caused mixed-content
  // since Studio is served over HTTPS.)
  globalTrustedHosts: ["https://canvas.aihe.dev", "https://studio.aihe.dev"],
  defaultHostUrl: "https://canvas.aihe.dev",
};
