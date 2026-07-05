/**
 * Proxy routes for the Design Assistant (ClickUp 86ey5b413) — the in-Studio
 * Copilot box's backend when the `designAssistCopilot` devflag is on.
 *
 * These forward {projectId, request} to the external design-assist service
 * (via its public n8n webhook) which turns natural language into typed,
 * atomic model mutations with a plan → confirm → apply protocol:
 *
 *   POST /api/v1/design-assist/plan   {projectId, request, pagePath?}
 *   POST /api/v1/design-assist/apply  {projectId, planId}
 *
 * SECURITY: unlike the legacy /copilot/ui route (which only *generates* HTML
 * and relies on the browser's own session to persist anything), a design-
 * assist apply is a real server-authoritative write performed by the assist
 * service's own Studio account. This proxy is therefore the ONLY place
 * per-user authorization is enforced — both routes require "content"
 * permission on the project, and there is deliberately NO public/
 * unauthenticated variant.
 */
import { userDbMgr } from "@/wab/server/routes/util";
import {
  getDesignAssistBearerToken,
  getDesignAssistWebhookUrl,
} from "@/wab/server/secrets";
import { BadRequestError } from "@/wab/shared/ApiErrors/errors";
import { ProjectId } from "@/wab/shared/ApiSchema";
import { Request, Response } from "express-serve-static-core";
import fetch from "node-fetch";

// The n8n webhook sits behind Cloudflare (~100s cap); live plan runs have
// measured 18-47s. Apply is a single Studio REST round-trip plus a verify
// re-read.
const PLAN_TIMEOUT_MS = 85_000;
const APPLY_TIMEOUT_MS = 30_000;
const MAX_REQUEST_CHARS = 10_000;

async function forwardToDesignAssist(
  req: Request,
  res: Response,
  action: "plan" | "apply",
  timeoutMs: number
) {
  const projectId = req.body?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new BadRequestError("projectId is required");
  }
  const mgr = userDbMgr(req);
  await mgr.checkProjectPerms(
    projectId as ProjectId,
    "content",
    "run design-assist"
  );

  const webhookUrl = getDesignAssistWebhookUrl();
  const bearerToken = getDesignAssistBearerToken();
  if (!webhookUrl || !bearerToken) {
    res.status(501).json({
      code: "DESIGN_ASSIST_NOT_CONFIGURED",
      error:
        "The design assistant is not configured on this server (DESIGN_ASSIST_WEBHOOK_URL / DESIGN_ASSIST_BEARER_TOKEN).",
    });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ ...req.body, action, projectId }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 500) };
    }
    // Business refusals (REVISION_CONFLICT / PLAN_NOT_FOUND / BATCH_REFUSED)
    // are returned as HTTP 200 with the JSON `code` field: the Studio ajax
    // layer discards structured bodies on non-2xx responses, and the Copilot
    // client needs the code to show the right guidance. Anything else keeps
    // the upstream status (the n8n webhook historically flattens errors to
    // 200 anyway — the JSON status/code fields are authoritative).
    const isBusinessRefusal =
      [404, 409, 422].includes(upstream.status) &&
      typeof (body as { code?: unknown })?.code === "string";
    res.status(isBusinessRefusal ? 200 : upstream.status).json(body);
  } catch (err) {
    res.status(504).json({
      code: "DESIGN_ASSIST_UNAVAILABLE",
      error:
        "The design assistant did not respond in time. Nothing may have been applied — check the project history before retrying.",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function planDesignAssist(req: Request, res: Response) {
  const request = req.body?.request;
  if (typeof request !== "string" || !request.trim()) {
    throw new BadRequestError("request is required");
  }
  if (request.length > MAX_REQUEST_CHARS) {
    throw new BadRequestError(
      `request is too long (max ${MAX_REQUEST_CHARS} characters)`
    );
  }
  await forwardToDesignAssist(req, res, "plan", PLAN_TIMEOUT_MS);
}

export async function applyDesignAssist(req: Request, res: Response) {
  const planId = req.body?.planId;
  if (typeof planId !== "string" || !planId.trim()) {
    throw new BadRequestError("planId is required");
  }
  await forwardToDesignAssist(req, res, "apply", APPLY_TIMEOUT_MS);
}
