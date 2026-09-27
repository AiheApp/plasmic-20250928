import {
  getMigratedBundle,
} from "@/wab/server/db/BundleMigrator";
import { unbundleSite } from "@/wab/server/db/bundle-migration-utils";
import { NotFoundError } from "@/wab/shared/ApiErrors/errors";
import { ProjectId } from "@/wab/shared/ApiSchema";
import { Bundler } from "@/wab/shared/bundler";
import { TplMgr } from "@/wab/shared/TplMgr";
import { deleteStyleToken } from "@/wab/client/operations/delete-style-token";
import { Request, Response } from "express-serve-static-core";
import {
  commitTransaction,
  startTransaction,
  superDbMgr,
  userDbMgr,
} from "@/wab/server/routes/util";
import { ensureKnownSite } from "@/wab/shared/model/classes";

function serializeToken(t: {
  uuid: string;
  name: string;
  type: string;
  value: string;
  isRegistered: boolean;
}) {
  return {
    uuid: t.uuid,
    name: t.name,
    type: t.type,
    value: t.value,
    isRegistered: t.isRegistered,
  };
}

export async function listStyleTokens(req: Request, res: Response) {
  const projectId = req.params.projectId as ProjectId;
  const mgr = userDbMgr(req);
  const suMgr = superDbMgr(req);
  const latestRev = await mgr.getLatestProjectRev(projectId, undefined);
  const oldBundle = await getMigratedBundle(latestRev);
  const bundler = new Bundler();
  const site = ensureKnownSite(
    (await unbundleSite(bundler, oldBundle, suMgr, latestRev)).siteOrProjectDep
  );
  res.json({ tokens: site.styleTokens.map(serializeToken) });
}

export async function createStyleToken(req: Request, res: Response) {
  const projectId = req.params.projectId as ProjectId;
  const { name, type, value } = req.body as {
    name: string;
    type: string;
    value: string;
  };

  const { commit } = await startTransaction(req, async () => {
    const mgr = userDbMgr(req);
    const suMgr = superDbMgr(req);

    const latestRev = await mgr.getLatestProjectRev(projectId, undefined);
    const oldBundle = await getMigratedBundle(latestRev);
    const bundler = new Bundler();
    const site = ensureKnownSite(
      (await unbundleSite(bundler, oldBundle, suMgr, latestRev)).siteOrProjectDep
    );

    const tplMgr = new TplMgr({ site });
    const token = tplMgr.addStyleToken({
      name,
      tokenType: type as any,
      value,
    });

    const newBundle = bundler.bundle(site, latestRev.id, oldBundle.version);
    await mgr.saveProjectRev({
      projectId,
      data: JSON.stringify(newBundle),
      revisionNum: latestRev.revision + 1,
    });

    return commitTransaction({ token: serializeToken(token) });
  });

  res.json({ token: commit.token });
}

export async function updateStyleToken(req: Request, res: Response) {
  const projectId = req.params.projectId as ProjectId;
  const tokenId = req.params.tokenId;
  const { name, value } = req.body as { name?: string; value?: string };

  const { commit } = await startTransaction(req, async () => {
    const mgr = userDbMgr(req);
    const suMgr = superDbMgr(req);

    const latestRev = await mgr.getLatestProjectRev(projectId, undefined);
    const oldBundle = await getMigratedBundle(latestRev);
    const bundler = new Bundler();
    const site = ensureKnownSite(
      (await unbundleSite(bundler, oldBundle, suMgr, latestRev)).siteOrProjectDep
    );

    const token = site.styleTokens.find((t) => t.uuid === tokenId);
    if (!token) {
      throw new NotFoundError(`Style token ${tokenId} not found`);
    }

    const tplMgr = new TplMgr({ site });
    if (name !== undefined) {
      tplMgr.renameStyleToken(token, name);
    }
    if (value !== undefined) {
      token.value = value;
    }

    const newBundle = bundler.bundle(site, latestRev.id, oldBundle.version);
    await mgr.saveProjectRev({
      projectId,
      data: JSON.stringify(newBundle),
      revisionNum: latestRev.revision + 1,
    });

    return commitTransaction({ token: serializeToken(token) });
  });

  res.json({ token: commit.token });
}

export async function deleteStyleTokenRoute(req: Request, res: Response) {
  const projectId = req.params.projectId as ProjectId;
  const tokenId = req.params.tokenId;

  await startTransaction(req, async () => {
    const mgr = userDbMgr(req);
    const suMgr = superDbMgr(req);

    const latestRev = await mgr.getLatestProjectRev(projectId, undefined);
    const oldBundle = await getMigratedBundle(latestRev);
    const bundler = new Bundler();
    const site = ensureKnownSite(
      (await unbundleSite(bundler, oldBundle, suMgr, latestRev)).siteOrProjectDep
    );

    const token = site.styleTokens.find((t) => t.uuid === tokenId);
    if (!token) {
      throw new NotFoundError(`Style token ${tokenId} not found`);
    }

    deleteStyleToken({ site, token });

    const newBundle = bundler.bundle(site, latestRev.id, oldBundle.version);
    await mgr.saveProjectRev({
      projectId,
      data: JSON.stringify(newBundle),
      revisionNum: latestRev.revision + 1,
    });

    return commitTransaction({});
  });

  res.json({ deleted: tokenId });
}
