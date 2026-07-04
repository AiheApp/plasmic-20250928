import { InsertRelLoc } from "@/wab/client/components/canvas/view-ops";
import { CopilotPromptDialog } from "@/wab/client/components/copilot/CopilotPromptDialog";
import { useStudioCtx } from "@/wab/client/studio-ctx/StudioCtx";
import { pasteFromWebImporter } from "@/wab/client/web-importer/WebImporter";
import { addOrUpsertTokens } from "@/wab/commons/StyleToken";
import {
  CopilotInteractionId,
  DesignAssistApplyResponse,
  QueryCopilotUiRequest,
  QueryCopilotUiResponse,
  UpsertTokenReq,
} from "@/wab/shared/ApiSchema";
import { ensure, spawn } from "@/wab/shared/common";
import { ComponentType } from "@/wab/shared/core/components";
import { fixJson } from "@/wab/shared/copilot/fix-json";
import { Component } from "@/wab/shared/model/classes";
import { notification } from "antd";
import * as React from "react";

/**
 * The Copilot box has two backends:
 *
 * - Legacy (default): POST /copilot/ui generates an HTML snippet client-side
 *   pasted at the current selection.
 * - Design assist (devflag `designAssistCopilot`, ClickUp 86ey5b413): the
 *   prompt goes to the design-assist service, which plans typed, atomic
 *   model mutations; the designer confirms the plan preview, and the apply
 *   lands server-side as ONE revision.
 */
function CopilotUiPrompt() {
  const studioCtx = useStudioCtx();
  return studioCtx.designAssistCopilotEnabled() ? (
    <DesignAssistCopilotPrompt />
  ) : (
    <LegacyCopilotUiPrompt />
  );
}

interface DesignAssistPlanRef {
  planId: string;
  summary: string;
}

function DesignAssistCopilotPrompt() {
  const studioCtx = useStudioCtx();
  const api = studioCtx.appCtx.api;
  const projectId = studioCtx.siteInfo.id;

  const applyPlan = async (plan: DesignAssistPlanRef) => {
    // Flush unsaved edits FIRST: the apply is a server-side full-bundle save
    // and the post-apply sync below discards unsaved local changes (socket
    // broadcast delivery can't be relied on in the self-hosted deployment;
    // see StudioCtx.syncFromServer). If this flush advances the project past
    // the plan's baseRevision the service refuses with REVISION_CONFLICT —
    // safe, and honest: the plan no longer matches what the designer sees.
    await studioCtx.save();
    const result: DesignAssistApplyResponse = await api.queryDesignAssistApply(
      { projectId, planId: plan.planId }
    );

    // The n8n webhook may flatten upstream HTTP errors to 200 — the JSON
    // status/code fields are authoritative.
    if (result.code === "REVISION_CONFLICT") {
      notification.warning({
        message: "Project changed since the plan was made",
        description:
          "Nothing was applied. Ask the assistant again to get a fresh plan.",
        duration: 8,
      });
      return;
    }
    if (result.code === "PLAN_NOT_FOUND") {
      notification.warning({
        message: "This plan has expired",
        description:
          "Nothing was applied. Ask the assistant again to get a fresh plan.",
        duration: 8,
      });
      return;
    }
    if (result.code || result.status === "failed" || !result.revisions) {
      notification.error({
        message: "The assistant could not apply the change",
        description: result.summary ?? result.error ?? "Nothing was applied.",
        duration: 0,
      });
      return;
    }

    // The change landed server-side; pull it into the open canvas.
    await studioCtx.syncFromServer();

    if (result.status === "partial_failure") {
      notification.warning({
        message: "Change applied with warnings",
        description: [result.summary, ...(result.integrityIssues ?? [])].join(
          "\n"
        ),
        duration: 0,
      });
    } else {
      notification.success({
        message: "Change applied",
        description: result.summary ?? plan.summary,
        duration: 6,
      });
    }
  };

  return (
    <CopilotPromptDialog<DesignAssistPlanRef>
      className={"CopilotUiPromptDialog"}
      type={"design-assist"}
      showImageUpload={false}
      dialogOpen={studioCtx.showUiCopilot}
      onDialogOpenChange={(isOpen) => {
        studioCtx.openUiCopilotDialog(isOpen);
      }}
      onCopilotSubmit={async ({ prompt }) => {
        // Flush before planning too, so the plan is computed against a head
        // that includes the designer's latest edits.
        await studioCtx.save();
        const result = await api.queryDesignAssistPlan({
          projectId,
          request: prompt,
        });

        if (result.code || result.error) {
          throw new Error(
            result.error ??
              `The design assistant is unavailable (${result.code}).`
          );
        }

        const isReady = result.status === "ready" && !!result.planId;
        const displayMessage = isReady
          ? result.preview
            ? `${result.summary}\n\n${result.preview}`
            : result.summary
          : result.question
          ? `${result.summary}\n\n${result.question}`
          : result.summary;

        return {
          response: isReady
            ? { planId: result.planId!, summary: result.summary }
            : undefined,
          displayMessage,
          copilotInteractionId: isReady
            ? (result.planId as CopilotInteractionId)
            : undefined,
        };
      }}
      onCopilotApply={(plan) => {
        spawn(
          applyPlan(plan).catch((err) => {
            notification.error({
              message: "The assistant could not apply the change",
              description:
                (err as Error)?.message ?? "Nothing may have been applied.",
              duration: 0,
            });
          })
        );
      }}
    />
  );
}

function LegacyCopilotUiPrompt() {
  const studioCtx = useStudioCtx();

  return (
    <CopilotPromptDialog<QueryCopilotUiResponse["response"]>
      className={"CopilotUiPromptDialog"}
      type={"ui"}
      showImageUpload={true}
      dialogOpen={studioCtx.showUiCopilot}
      onDialogOpenChange={(isOpen) => {
        studioCtx.openUiCopilotDialog(isOpen);
      }}
      onCopilotSubmit={async ({
        prompt,
        images,
        modelProviderOverride,
        copilotSystemPromptOverride,
      }) => {
        const copilotQuery = studioCtx.appCtx.selfInfo
          ? studioCtx.appCtx.api.queryUiCopilot
          : studioCtx.appCtx.api.queryPublicUiCopilot;
        const payload: QueryCopilotUiRequest = {
          type: "ui",
          goal: prompt,
          projectId: studioCtx.siteInfo.id,
          images,
          tokens: studioCtx.site.styleTokens.map((t) => ({
            name: t.name,
            uuid: t.uuid,
            type: t.type,
            value: t.value,
          })),
        };
        if (modelProviderOverride) {
          try {
            payload.modelProviderOverride = JSON.parse(
              fixJson(modelProviderOverride)
            );
          } catch (e) {
            throw new Error(
              `Invalid model provider override format. Expected JSON object like:\n{"provider": "Anthropic", "modelName": "claude-3-5-sonnet-20241022", "maxTokens": 32000, "temperature": 0}\n\nValid providers: "Anthropic", "Cloudflare", "Google", "OpenAI"`
            );
          }
        }
        if (copilotSystemPromptOverride) {
          payload.copilotSystemPromptOverride = copilotSystemPromptOverride;
        }
        const result = await copilotQuery(payload);

        const response = result.response;
        const { tokens, html } = response;

        const messageParts: string[] = [];

        if (html.trim()) {
          messageParts.push("• A new HTML design snippet is ready to be used");
        }

        const newTokensCount = tokens.length;
        if (newTokensCount > 0) {
          messageParts.push(
            `• ${newTokensCount} new token${
              newTokensCount > 1 ? "s" : ""
            } is ready to be used`
          );
        }

        return {
          response,
          displayMessage: messageParts.join("\n"),
          copilotInteractionId: result.copilotInteractionId,
        };
      }}
      onCopilotApply={async (response) => {
        const { tokens, html } = response;

        try {
          // 1. Upsert any design tokens the copilot proposed.
          if (tokens.length) {
            await studioCtx.change(({ success }) => {
              const upsertTokens: UpsertTokenReq[] = tokens.map((t) => ({
                name: t.name,
                value: t.value,
                type: t.tokenType,
              }));
              addOrUpsertTokens(studioCtx.site, upsertTokens);
              return success();
            });
          }

          // 2. Make sure there's a frame to paste into. In an empty arena
          // (e.g. a brand-new project with no component yet) there's no
          // ViewCtx, so create a Page to receive the generated component —
          // otherwise the paste silently fails and nothing lands on canvas.
          const viewCtx =
            studioCtx.focusedViewCtx() ?? studioCtx.focusedOrFirstViewCtx();
          if (!viewCtx) {
            let createdComp: Component | undefined;
            await studioCtx.change(({ success }) => {
              createdComp = studioCtx.addComponent("Copilot Page", {
                type: ComponentType.Page,
              });
              return success();
            });
            // Open the new page so it has a focused ViewCtx the paste can use.
            await studioCtx.getViewCtxForComponent(
              ensure(createdComp, "expected created copilot page component")
            );
          }

          // 3. Paste the generated HTML. pasteFromWebImporter runs its own
          // change transaction, so it must run outside the changes above.
          // When the focused frame enforces pasting as a sibling, insert
          // after rather than as a child.
          const insertRelLoc = studioCtx.focusedViewCtx()
            ?.enforcePastingAsSibling
            ? InsertRelLoc.after
            : undefined;
          await pasteFromWebImporter(html, {
            studioCtx,
            insertRelLoc,
            cursorClientPt: undefined,
          });
        } catch {
          notification.error({
            message: "Couldn't place the generated component",
            description:
              "Open a page or select a frame on the canvas, then click Apply again.",
          });
        }
      }}
    />
  );
}

export { CopilotUiPrompt };
