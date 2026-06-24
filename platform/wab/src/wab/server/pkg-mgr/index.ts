import { getLastBundleVersion } from "@/wab/server/db/BundleMigrator";
import { unbundleWithDeps } from "@/wab/server/db/DbBundleLoader";
import { DbMgr } from "@/wab/server/db/DbMgr";
import { Pkg, PkgVersion, User } from "@/wab/server/entities/Entities";
import { logger } from "@/wab/server/observability";
import { Bundle, Bundler } from "@/wab/shared/bundler";
import { assert, ensureType } from "@/wab/shared/common";
import { defaultComponentKinds } from "@/wab/shared/core/components";
import {
  DevFlagsType,
  InsertableTemplatesGroup,
  Installable,
} from "@/wab/shared/devflags";
import { InsertableId } from "@/wab/shared/insertables";
import { ProjectDependency } from "@/wab/shared/model/classes";
import fs from "fs";
import { kebabCase, startCase } from "lodash";
import path from "path";
/**
 * PkgMgr is responsible for generating Plasmic projects from data/*-master-pkg.json files.
 * This helps seed our localhost dev setup with a set of important Plasmic projects (like Plume, Plexus, etc.)
 *
 * Feel free to add more projects to data/*-master-pkg.json and then running `yarn db:reset` should create those projects locally
 *
 * To download a project's data/*-master-pkg.json file from prod, use studio.plasmic.app/admin/dev -> Download Pkg as JSON for Pkg-mgr
 */
export class PkgMgr {
  constructor(private db: DbMgr, private sysname: InsertableId) {
    logger().info(`created with sysname ${sysname}`);
  }

  async unbundleAndSave(
    bundle: Bundle,
    user: User,
    depPkgVersionId: string,
    sysname?: InsertableId
  ) {
    const name = bundle.map[bundle.root].name;
    const projectId = bundle.map[bundle.root].projectId;
    const pkgId = bundle.map[bundle.root].pkgId;
    const { project } = await this.db.createProject({
      name,
      ownerId: user.id,
      projectId,
      // We want Plume and PLexus (and its dependencies) to have general read access, so that any other non-admin project can install them
      inviteOnly: false,
    });
    logger().info(
      `Created ${this.sysname} ${name} project ${project.id} for user ${user.email}`
    );

    // Create the pkg linked to that project, so that the developer
    // can continue updating the project and publishing new changes locally
    const pkg = await this.db.createSysPkg(sysname ?? name, project.id, pkgId);

    await this.upsertLatest(pkg, bundle, depPkgVersionId);
  }

  /**
   * Seeds a fresh database with an initial pkg
   */
  async seedPkg() {
    assert(
      !(await this.tryGetPkg(this.sysname)),
      `Not expecting a ${this.sysname} pkg to already exist`
    );

    // Create a new project, owned by the "oldest" user
    const user = await this.db
      .getEntMgr()
      .getRepository(User)
      .createQueryBuilder()
      .orderBy({
        '"createdAt"': "ASC",
      })
      .limit(1)
      .getOneOrFail();

    const {
      master: [masterPkgVersionId, masterBundle],
      deps,
    } = parseMasterPkg(this.sysname);
    await Promise.all(
      deps.map(async ([depPkgVersionId, bundle]) => {
        await this.unbundleAndSave(bundle, user, depPkgVersionId);
      })
    );

    await this.unbundleAndSave(
      masterBundle,
      user,
      masterPkgVersionId,
      this.sysname
    );
  }

  /**
   * Updates the existing pkg to be the content of master-pkg.json
   */
  async upgradePkg() {
    logger().info(`Upgrading ${this.sysname}...`);
    const pkg = await this.tryGetPkg(this.sysname);
    if (!pkg) {
      logger().info(`Creating ${this.sysname} pkg for the first time...`);
      await this.seedPkg();
      return;
    }

    const {
      master: [masterPkgVersionId, masterBundle],
      deps,
    } = parseMasterPkg(this.sysname);
    await Promise.all(
      deps.map(async ([depPkgVersionId, bundle]) => {
        const depName = bundle.map[bundle.root].name;
        const depPkg = await this.tryGetPkg(depName);
        if (!depPkg) {
          throw new Error(
            `Could not find dependency ${depName} of existing ${this.sysname} pkg`
          );
        }
        await this.upsertLatest(depPkg, bundle, depPkgVersionId);
      })
    );
    await this.upsertLatest(pkg, masterBundle, masterPkgVersionId);
  }

  private async upsertLatest(
    pkg: Pkg,
    pkgBundle: Bundle,
    pkgVersionId: string
  ) {
    const rev = await this.db.getLatestProjectRev(pkg.projectId);

    const bundler = new Bundler();
    const dep = (await unbundleWithDeps(
      this.db,
      bundler,
      pkg.projectId,
      pkgBundle
    )) as ProjectDependency;

    const deleteRes = await this.db
      .getEntMgr()
      .getRepository(PkgVersion)
      .delete({
        pkgId: pkg.id,
      });
    logger().info(
      `Deleting existing versions (there are ${deleteRes.affected})`
    );

    logger().info(`Updating to ${this.sysname} package version ${dep.version}`);
    const newRev = await this.db.saveProjectRev({
      projectId: rev.projectId,
      data: JSON.stringify(
        bundler.bundle(dep.site, rev.projectId, await getLastBundleVersion())
      ),
      revisionNum: rev.revision + 1,
    });
    logger().info(`created a new revision ${newRev.revision}`);
    // create the new pkg version with the same pkgId as in the master-pkg.json, because it will be used in the deps array
    const pkgVersion = await this.db.insertPkgVersion(
      pkg.id,
      dep.version,
      JSON.stringify(pkgBundle),
      [],
      "",
      newRev.revision,
      undefined,
      pkgVersionId
    );
    logger().info(`inserted a pkg version ${pkgVersion.id}`);
  }

  private async tryGetPkg(sysname: InsertableId) {
    return await this.db.getEntMgr().getRepository(Pkg).findOne({
      where: {
        sysname,
      },
    });
  }
}

export function getBundleInfo(sysname: InsertableId) {
  const {
    master: [_, bundle],
  } = parseMasterPkg(sysname);
  const root = bundle.map[bundle.root];
  const { projectId, site } = root;
  return { bundle, projectId, site, sysname };
}

export function parseMasterPkg(sysname: InsertableId) {
  const projectData = JSON.parse(
    fs
      .readFileSync(path.join(__dirname, "data", `${sysname}-master-pkg.json`))
      .toString()
  ) as [string, Bundle][];

  const deps = projectData.slice(0, -1);
  const master = projectData.slice(-1)[0];

  return { master, deps };
}

/**
 * Builds the devflag overrides that wire the seeded Plexus pkg into Studio's
 * insert panel: the "Plasmic Design System" installable, the per-component
 * insertable templates, and the insert-panel sections — all pointing at the
 * given Plexus project id.
 *
 * This is the single source of truth shared by `DbInit` (full `db:reset`
 * seeding) and the `plexus-pkg-mgr` CLI (applying onto an existing instance),
 * so the wiring stays identical regardless of how Plexus was localized.
 */
export function buildPlexusDevFlagOverrides(plexusBundleInfo: {
  projectId: string;
  sysname: InsertableId;
}): Partial<DevFlagsType> {
  return {
    plexus: true,
    installables: ensureType<Installable[]>([
      {
        type: "ui-kit",
        isInstallOnly: true,
        isNew: true,
        name: "Plasmic Design System",
        projectId: plexusBundleInfo.projectId,
        imageUrl: "https://static1.plasmic.app/plasmic-logo.png",
        entryPoint: {
          type: "arena",
          name: "Components",
        },
      },
    ]),
    insertableTemplates: ensureType<InsertableTemplatesGroup>({
      type: "insertable-templates-group",
      name: "root",
      // The below achieves the following for each plexus component:
      // {
      //   "type": "insertable-templates-component",
      //   "projectId": "mSQqkNd8CL5vNdDTXJPXfU",
      //   "componentName": "Plexus Button",
      //   "templateName": "plexus/button",
      //   "imageUrl": "https://static1.plasmic.app/antd_button.svg"
      // }
      items: [
        {
          type: "insertable-templates-group" as const,
          name: "Components",
          items: Object.keys(defaultComponentKinds).map((item) => ({
            componentName: startCase(item),
            templateName: `${plexusBundleInfo.sysname}/${kebabCase(item)}`,
            imageUrl: `https://static1.plasmic.app/insertables/${kebabCase(
              item
            )}.svg`,
            type: "insertable-templates-component" as const,
            projectId: plexusBundleInfo.projectId,
            tokenResolution: "reuse-by-name" as const,
          })),
        },
      ].filter((insertableGroup) => insertableGroup.items.length > 0),
    }),
    insertPanelContent: {
      componentsLabel: "Custom components",
      overrideSections: {},
      aliases: {
        // Components provided by @plasmicapp/react-web
        dataFetcher: "builtincc:plasmic-data-source-fetcher",
        pageMeta: "builtincc:hostless-plasmic-head",

        // Default components
        ...Object.keys(defaultComponentKinds).reduce((acc, defaultKind) => {
          acc[defaultKind] = `default:${defaultKind}`;
          return acc;
        }, {}),
      },
      builtinSections: {
        Home: {
          Basic: [
            "text",
            "heading",
            "link",
            "linkContainer",
            "section",
            "columns",
            "vstack",
            "hstack",
            "grid",
            "box",
            "image",
            "icon",
          ],
          // This may use Plexus or Plume depending on the `plexus` devflag
          "Customizable components": Object.keys(defaultComponentKinds),
          Advanced: ["pageMeta", "dataFetcher"],
        },
      },
      // Install all button
      builtinSectionsInstallables: {
        // We only need it for Plexus
        "Customizable components": plexusBundleInfo.projectId,
      },
    },
  };
}
