import {
  bundleModules,
  LoaderBundleOutput,
} from "@/wab/server/loader/module-bundler";
import { writeCodeBundlesToDisk } from "@/wab/server/loader/module-writer";
import { logger } from "@/wab/server/observability";
import {
  CachedCodegenOutputBundle,
  ComponentReference,
} from "@/wab/server/workers/codegen";
import { spawnWrapper } from "@/wab/shared/common";
import tmp from "tmp";

export async function workerBuildAssets(
  codegenOutputs: CachedCodegenOutputBundle[],
  componentDeps: Record<string, string[]>,
  componentRefs: ComponentReference[],
  platform: "react" | "nextjs" | "gatsby" | "tanstack",
  opts: {
    mode: "production" | "development";
    loaderVersion: number;
    browserOnly: boolean;
  }
): Promise<LoaderBundleOutput> {
  return new Promise<LoaderBundleOutput>((resolve, reject) => {
    tmp.dir(
      { unsafeCleanup: true },
      spawnWrapper(async (err, dir, cleanup) => {
        if (err) {
          return reject(err); // ensure no further execution
        }

        try {
          logger().info(`Building worker assets in ${dir}`);

          // Write generated code to disk
          await writeCodeBundlesToDisk(dir, codegenOutputs);

          // Bundle the modules
          const result = await bundleModules(
            dir,
            codegenOutputs,
            componentDeps,
            componentRefs,
            {
              platform,
              mode: opts.mode,
              loaderVersion: opts.loaderVersion,
              browserOnly: opts.browserOnly,
            }
          );

          // Success: resolve and cleanup
          resolve(result);
          cleanup();
        } catch (err2: unknown) {
          if (err2 instanceof Error) {
            logger().error(`Error bundling in ${dir}: ${err2.message}`, err2);
          } else {
            logger().error(`Unknown error bundling in ${dir}:`, err2);
          }
          reject(err2);
          // Note: we intentionally don't cleanup here to allow debugging
        }
      })
    );
  });
}
