// Stand-in for upstream's private @plasmic-shared/hosting workspace package.
// platform/wab depends on it ("workspace:*") but the open-source tree doesn't
// include platform/shared/, so pnpm can't install the platform workspace
// without it. wab only imports types from it.

export interface PlasmicHostingSettings {
  favicon?: {
    url: string;
    mimeType?: string;
  };
  /** Text served at a path, e.g. { "/robots.txt": "..." }. */
  textFiles?: { [path: string]: string };
}
