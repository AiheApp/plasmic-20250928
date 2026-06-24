import { loadConfig } from "@/wab/server/config";
import { ensureDbConnection } from "@/wab/server/db/DbCon";
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { logger } from "@/wab/server/observability";
import {
  buildPlexusDevFlagOverrides,
  getBundleInfo,
  PkgMgr,
} from "@/wab/server/pkg-mgr";
import { spawn } from "@/wab/shared/common";
import { PLEXUS_INSERTABLE_ID } from "@/wab/shared/insertables";
import yargs from "yargs";

/**
 * Seeds (or upgrades) the Plexus design system pkg into the database the
 * current config points at, WITHOUT a destructive `yarn db:reset`. This is the
 * supported way to "localize" Plexus onto an already-running self-hosted
 * Plasmic instance whose initial seed was skipped to preserve existing users
 * and projects.
 *
 * `PkgMgr.upgradePkg()` seeds the pkg (and its deps) from
 * `data/plexus-master-pkg.json` if it does not yet exist, or upgrades it in
 * place otherwise. The bundled master pkg already carries the canonical Plexus
 * project id, so no project needs to be hand-built.
 */
async function updatePlexusPkg() {
  const config = loadConfig();
  const con = await ensureDbConnection(config.databaseUri, "default");
  await con.transaction(async (em) => {
    const db = new DbMgr(em, SUPER_USER);
    const mgr = new PkgMgr(db, PLEXUS_INSERTABLE_ID);
    await mgr.upgradePkg();
  });
}

/**
 * Prints the devflag overrides that wire the seeded Plexus pkg into Studio's
 * insert panel (installable + insertable templates + insert-panel sections),
 * pointing at the bundled Plexus project id. Paste the output into the admin
 * devflags panel (`/admin` -> Dev flags, backed by
 * `POST /api/v1/admin/devflags`) so the localization survives without re-running
 * the full seed. Note: this prints ONLY the Plexus-related keys; the admin
 * panel merges them into the existing devflag overrides.
 */
function printPlexusDevFlags() {
  const plexusBundleInfo = getBundleInfo(PLEXUS_INSERTABLE_ID);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(buildPlexusDevFlagOverrides(plexusBundleInfo), null, 2)
  );
}

export async function main() {
  await yargs
    .usage("Usage: $0 <command> [options]")
    .command(
      "update",
      "Seeds or upgrades the Plexus pkg into the configured database",
      () => {},
      async () => {
        try {
          await updatePlexusPkg();
        } catch (err) {
          logger().error("Error updating plexus pkg", err);
          process.exit(1);
        }
      }
    )
    .command(
      "print-devflags",
      "Prints the Plexus devflag overrides to apply via the admin panel",
      () => {},
      () => printPlexusDevFlags()
    )
    .demandCommand()
    .help("h")
    .alias("h", "help").argv;
}

if (require.main === module) {
  spawn(main());
}
