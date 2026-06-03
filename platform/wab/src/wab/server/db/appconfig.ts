import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  applyDevFlagOverridesToDefaults,
  DevFlagsType,
} from "@/wab/shared/devflags";

/**
 * WARNING: This function may return devflags inconsistent with the DEVFLAGS.
 * DEVFLAGS is only computed once, when the server starts.
 * If an override is submitted after the server starts, this function will
 * include the new overrides, while DEVFLAGS will stay the same.
 *
 * PERF: this runs in a per-request middleware (AppServer), and
 * `applyDevFlagOverridesToDefaults` deep-clones + merges the (large)
 * DEFAULT_DEVFLAGS object, which costs ~1s of CPU per call. Recomputing it on
 * every request dominated API latency. Since the result is a pure function of
 * the stored override string (DEFAULT_DEVFLAGS is fixed at startup), we memoize
 * by that string: the cheap DB read still runs each request (so admin override
 * edits take effect immediately on the next request), but the expensive
 * clone+merge only reruns when the override data actually changes. The cached
 * object is shared across requests; this is safe because callers only ever READ
 * req.devflags (it is never mutated downstream).
 */
let cachedOverrideData: string | undefined;
let cachedMergedFlags: DevFlagsType | undefined;

export async function getDevFlagsMergedWithOverrides(
  mgr: DbMgr
): Promise<DevFlagsType> {
  const overrides = await mgr.tryGetDevFlagOverrides();
  const data = overrides?.data ?? "{}";
  if (data !== cachedOverrideData || !cachedMergedFlags) {
    cachedMergedFlags = applyDevFlagOverridesToDefaults(JSON.parse(data));
    cachedOverrideData = data;
  }
  return cachedMergedFlags;
}
