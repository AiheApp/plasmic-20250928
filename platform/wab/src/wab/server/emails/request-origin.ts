import { Request } from "express-serve-static-core";

/**
 * Origin to build email links against. Self-hosted deployments serve Studio
 * from whatever domain the user signed up on, so prefer the request's own
 * origin over the configured host.
 */
export function getRequestOrigin(req: Request): string {
  const host = req.get?.("host");
  return (
    req.headers?.origin ||
    (host ? `${req.protocol}://${host}` : req.config.host)
  );
}
