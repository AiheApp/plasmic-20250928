import { InsertRelLoc } from "@/wab/client/components/canvas/view-ops";
import { CopilotPromptDialog } from "@/wab/client/components/copilot/CopilotPromptDialog";
import { useStudioCtx } from "@/wab/client/studio-ctx/StudioCtx";
import { pasteFromWebImporter } from "@/wab/client/web-importer/WebImporter";
import { addOrUpsertTokens } from "@/wab/commons/StyleToken";
import {
  QueryCopilotUiRequest,
  QueryCopilotUiResponse,
  UpsertTokenReq,
} from "@/wab/shared/ApiSchema";
import { ensure } from "@/wab/shared/common";
import { ComponentType } from "@/wab/shared/core/components";
import { fixJson } from "@/wab/shared/copilot/fix-json";
import { Component } from "@/wab/shared/model/classes";
import { notification } from "antd";
import * as React from "react";

function CopilotUiPrompt() {
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
