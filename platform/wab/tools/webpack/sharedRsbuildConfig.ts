import type { RsbuildConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSass } from "@rsbuild/plugin-sass";
import { DefinePlugin, ProvidePlugin } from "@rspack/core";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import {
  OPTIONAL_VAR,
  REQUIRED_VAR,
  mkDefinePluginOptsForEnv,
} from "./mkDefinePluginOptsForEnv";

export function getCommitHash(): string {
  // Docker/CI builds have no .git; they pass the hash via COMMIT_HASH instead.
  try {
    const repoRoot = path.resolve(__dirname, "../../../..");
    if (!existsSync(path.join(repoRoot, ".git"))) {
      return process.env.COMMIT_HASH || "dev";
    }
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim().slice(0, 6);
    }
    return process.env.COMMIT_HASH || "dev";
  } catch {
    return process.env.COMMIT_HASH || "dev";
  }
}

/**
 * Base rsbuild config to bundle our code.
 *
 * Used by:
 * - App build ./rsbuild.config.ts
 * - Storybook .storybook/rsbuild.config.ts
 */
export function mkSharedRsbuildConfig(opts: {
  commitHash: string;
}): RsbuildConfig {
  const { commitHash } = opts;
  return {
    resolve: {
      alias: {
        // data-urls.ts only falls back to xmldom when there is no window.
        "@xmldom/xmldom": false,
      },
    },
    plugins: [pluginReact(), pluginSass()],
    tools: {
      rspack: {
        plugins: [
          new ProvidePlugin({
            process: [require.resolve("process/browser")],
            Buffer: ["buffer", "Buffer"],
          }),
          new DefinePlugin(
            mkDefinePluginOptsForEnv({
              NODE_ENV: REQUIRED_VAR,
              COMMITHASH: commitHash,
              STATIC_URL: OPTIONAL_VAR,
              POSTHOG_API_KEY: OPTIONAL_VAR,
              POSTHOG_HOST: OPTIONAL_VAR,
              POSTHOG_REVERSE_PROXY_HOST: OPTIONAL_VAR,
              SENTRY_DSN: OPTIONAL_VAR,
              SENTRY_ORG_ID: OPTIONAL_VAR,
              SENTRY_PROJECT_ID: OPTIONAL_VAR,
              STRIPE_PUBLISHABLE_KEY: OPTIONAL_VAR,
            }),
          ),
        ],
      },
    },
  };
}
