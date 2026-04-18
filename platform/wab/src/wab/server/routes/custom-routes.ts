import { toOpaque } from "@/wab/commons/types";
import {
  parseQueryParams,
  superDbMgr,
  userDbMgr,
  withNext,
} from "@/wab/server/routes/util";
import {
  CheckDomainResponse,
  DomainsForProjectResponse,
  GetSubscriptionResponse,
  PlasmicHostingSettings,
  ProjectId,
  RevalidatePlasmicHostingResponse,
  SetCustomDomainForProjectRequest,
  SetCustomDomainForProjectResponse,
  SetSubdomainForProjectRequest,
  SetSubdomainForProjectResponse,
} from "@/wab/shared/ApiSchema";
import { PLASMIC_HOSTING_DOMAIN_VALIDATOR } from "@/wab/shared/hosting";
import { Application, Request, Response } from "express";

export const ROUTES_WITH_TIMING = [];

export function addInternalRoutes(app: Application) {
  addHostingRoutes(app);
  addPaymentRoutes(app);
}

export function addInternalIntegrationsRoutes(app: Application) {}

function addHostingRoutes(app: Application) {
  app.get("/api/v1/check-domain", withNext(checkDomain));
  app.get(
    "/api/v1/domains-for-project/:projectId",
    withNext(getDomainsForProject)
  );
  app.put("/api/v1/subdomain-for-project", withNext(setSubdomainForProject));
  app.put(
    "/api/v1/custom-domain-for-project",
    withNext(setCustomDomainForProject)
  );
  app.get("/api/v1/plasmic-hosting/:projectId", withNext(getPlasmicHosting));
  app.put("/api/v1/plasmic-hosting/:projectId", withNext(updatePlasmicHosting));
  app.post("/api/v1/revalidate-hosting", withNext(revalidatePlasmicHosting));
}

function addPaymentRoutes(app: Application) {
  app.get(
    "/api/v1/billing/subscription/:teamId",
    withNext(getBillingSubscription)
  );
}

/**
 * Hook for custom logic for creating a team. If handled, returns true;
 * else returns false and default handling will take place.
 */
export async function customCreateTeam(req: Request, res: Response) {
  return false;
}

/**
 * Returns true if req corresponds to a custom public API request, and thus
 * does not need CSRF checking
 */
export function isCustomPublicApiRequest(req: Request) {
  return false;
}

async function checkDomain(req: Request, res: Response) {
  const { domain } = parseQueryParams(req) as { domain?: string };
  if (!domain || !PLASMIC_HOSTING_DOMAIN_VALIDATOR.isValidDomain(domain)) {
    const response: CheckDomainResponse = { status: { isValid: false } };
    res.json(response);
    return;
  }
  const isPlasmicSubdomain =
    PLASMIC_HOSTING_DOMAIN_VALIDATOR.isValidSubdomain(domain);
  const isAnyPlasmicDomain =
    PLASMIC_HOSTING_DOMAIN_VALIDATOR.isAnyPlasmicDomain(domain);
  const mgr = superDbMgr(req);
  const ownerProjectId = await mgr.tryGetProjectIdForDomain(domain);
  const response: CheckDomainResponse = {
    status: {
      isValid: true,
      isAvailable: !ownerProjectId,
      isPlasmicSubdomain,
      isAnyPlasmicDomain,
      isCorrectlyConfigured: true,
    },
  };
  res.json(response);
}

async function getDomainsForProject(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const projectId = toOpaque(req.params.projectId) as ProjectId;
  const domains = await mgr.getDomainsForProject(projectId);
  const response: DomainsForProjectResponse = { domains };
  res.json(response);
}

async function setSubdomainForProject(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const { subdomain, projectId } = req.body as SetSubdomainForProjectRequest;
  const current = await mgr.getDomainsForProject(projectId);
  const customDomains = current.filter(
    (d) => !PLASMIC_HOSTING_DOMAIN_VALIDATOR.isValidSubdomain(d)
  );
  const nextDomains = subdomain ? [subdomain, ...customDomains] : customDomains;
  await mgr.setDomainsForProject(nextDomains, projectId);
  const response: SetSubdomainForProjectResponse = { status: "DomainUpdated" };
  res.json(response);
}

async function setCustomDomainForProject(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const { customDomain, projectId } =
    req.body as SetCustomDomainForProjectRequest;
  const current = await mgr.getDomainsForProject(projectId);
  const subdomains = current.filter((d) =>
    PLASMIC_HOSTING_DOMAIN_VALIDATOR.isValidSubdomain(d)
  );
  const nextDomains = customDomain
    ? [...subdomains, customDomain]
    : subdomains;
  await mgr.setDomainsForProject(nextDomains, projectId);
  const response: SetCustomDomainForProjectResponse = {
    status: { "": "DomainUpdated" },
  };
  res.json(response);
}

async function getPlasmicHosting(req: Request, res: Response) {
  const response: PlasmicHostingSettings = {};
  res.json(response);
}

async function updatePlasmicHosting(req: Request, res: Response) {
  const response: PlasmicHostingSettings = {};
  res.json(response);
}

function revalidatePlasmicHosting(req: Request, res: Response) {
  const response: RevalidatePlasmicHostingResponse = {
    successes: [],
    failures: [],
  };
  res.json(response);
}

function getBillingSubscription(req: Request, res: Response) {
  const response: GetSubscriptionResponse = {
    type: "notFound",
  };
  res.json(response);
}
