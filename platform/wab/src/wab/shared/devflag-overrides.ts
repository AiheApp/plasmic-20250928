import type { DevFlagsType } from "@/wab/shared/devflags";

export const DEFAULT_DEVFLAG_OVERRIDES: Partial<DevFlagsType> = {
  enablePlasmicHosting: true,
  showCopilot: true,
  globalTrustedHosts: [
    "http://157.90.224.29:3005",
    "https://host.plasmic.157.90.224.29.sslip.io",
  ],
  defaultHostUrl: "https://host.plasmic.157.90.224.29.sslip.io/",
};
