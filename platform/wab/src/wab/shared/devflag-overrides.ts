import type { DevFlagsType } from "@/wab/shared/devflags";

export const DEFAULT_DEVFLAG_OVERRIDES: Partial<DevFlagsType> = {
  enablePlasmicHosting: false,
  showCopilot: true,
  globalTrustedHosts: ["http://157.90.224.29:3005"],
  defaultHostUrl: "http://157.90.224.29:3005/static/host.html",
};
