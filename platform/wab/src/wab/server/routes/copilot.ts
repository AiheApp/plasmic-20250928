import {
  createAnthropicClient,
  createCloudflareClient,
  createGeminiClient,
  createOpenAIClient,
} from "@/wab/server/copilot/llms";
import { uploadCopilotImages } from "@/wab/server/copilot/supabase-image-storage";
import { logger } from "@/wab/server/observability";
import { userDbMgr } from "@/wab/server/routes/util";
import {
  CopilotInteractionId,
  QueryCopilotUiRequest,
  QueryCopilotUiResponse,
} from "@/wab/shared/ApiSchema";
import {
  CopilotUiResponse,
  CopilotUiResponseSchema,
  CreateChatCompletionRequest,
  copilotUiResponseToActions,
} from "@/wab/shared/copilot/prompt-utils";
import { ModelProviderOpts } from "@/wab/shared/copilot/provider";
import { NextFunction, Request, Response } from "express-serve-static-core";

const DEFAULT_UI_SYSTEM_PROMPT = `You are a UI design assistant. The user will describe a UI component or page section, and you must generate it as clean HTML with inline CSS styles.

IMPORTANT: Your response MUST be valid JSON matching this exact schema:
{
  "tokens": [
    {
      "tokenType": "Color" | "Spacing" | "FontSize" | "LineHeight" | "FontFamily" | "Opacity",
      "name": "string (unique token name)",
      "value": "string (CSS value with unit, e.g. '10px', '#ff0000', '1.5rem')"
    }
  ],
  "html": "string (the <style>...</style><body>...</body> HTML content)"
}

Guidelines:
- Generate modern, clean, responsive HTML with inline styles in a <style> tag
- Use semantic HTML elements
- Include only the <style> and <body> tags (no <html>, <head>, or <DOCTYPE>)
- Extract meaningful design tokens for colors, spacing, font sizes, etc.
- Use placeholder images from https://placehold.co/ when images are needed
- Use a consistent design system with the extracted tokens
- Make the design visually appealing with proper spacing, typography, and color
- If the user provides existing tokens, try to reuse them in your design`;

function getSystemPrompt(
  request: QueryCopilotUiRequest
): string {
  if (request.copilotSystemPromptOverride) {
    return request.copilotSystemPromptOverride;
  }

  let prompt = DEFAULT_UI_SYSTEM_PROMPT;
  if (request.tokens && request.tokens.length > 0) {
    prompt += `\n\nExisting design tokens to reuse when appropriate:\n${JSON.stringify(request.tokens, null, 2)}`;
  }
  return prompt;
}

function createClient(providerOpts: ModelProviderOpts) {
  switch (providerOpts.provider) {
    case "Cloudflare":
      logger().info(
        `Using Cloudflare Workers AI model: ${providerOpts.modelName}`
      );
      return createCloudflareClient();
    case "Google":
      logger().info(
        `Using Gemini model: ${providerOpts.modelName}`
      );
      return createGeminiClient();
    case "Anthropic":
      return createAnthropicClient();
    case "OpenAI":
    default:
      return createOpenAIClient();
  }
}

function parseCopilotResponse(content: string): CopilotUiResponse {
  // Try to extract JSON from the response, handling cases where the LLM
  // wraps it in markdown code blocks
  let jsonStr = content.trim();

  // Strip markdown code fences if present
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  const raw = JSON.parse(jsonStr);

  // Normalize tokens: LLMs sometimes return "type" instead of "tokenType"
  if (Array.isArray(raw.tokens)) {
    raw.tokens = raw.tokens.map((t: Record<string, unknown>) => {
      if (t.type && !t.tokenType) {
        return { ...t, tokenType: t.type, type: undefined };
      }
      return t;
    });
  }

  const parsed = CopilotUiResponseSchema.parse(raw);
  return parsed;
}

async function handleCopilotUi(
  req: Request,
  res: Response,
  _next: NextFunction,
  isPublic: boolean
) {
  const body = req.body as QueryCopilotUiRequest;
  const { goal, images, projectId } = body;

  const modelProviderOpts: ModelProviderOpts =
    body.modelProviderOverride ??
    req.devflags.uiCopilotModelProviderOpts;

  const systemPrompt = getSystemPrompt(body);

  // Upload images to Supabase and build multimodal content for the LLM
  let userContent:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = goal;

  if (images && images.length > 0) {
    // Upload images to Supabase storage
    const storedImages = await uploadCopilotImages(images, projectId);
    if (storedImages.length > 0) {
      logger().info(
        `Copilot: uploaded ${storedImages.length} image(s) to Supabase for project ${projectId}`
      );
    }

    // Build multimodal content with base64 images for the LLM
    // Use OpenAI-compatible format (image_url with data URIs)
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: goal }];
    for (const image of images) {
      const mediaType = `image/${image.type === "jpg" ? "jpeg" : image.type}`;
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mediaType};base64,${image.base64}`,
        },
      });
    }
    userContent = contentParts;
  }

  const completionRequest: CreateChatCompletionRequest = {
    model: modelProviderOpts.modelName,
    max_tokens: modelProviderOpts.maxTokens,
    temperature: modelProviderOpts.temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  const client = createClient(modelProviderOpts);
  logger().info(
    `Copilot: calling ${modelProviderOpts.provider} model=${modelProviderOpts.modelName} goal="${goal?.substring(0, 50)}"`
  );
  let completion;
  try {
    completion = await client.createChatCompletion(completionRequest);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
    const errStack = err instanceof Error ? err.stack : "";
    logger().error(
      `Copilot LLM call failed: ${errMsg}\nStack: ${errStack}`
    );
    throw err;
  }

  const responseContent =
    completion.choices?.[0]?.message?.content ?? "";

  logger().info(
    `Copilot: got response, length=${responseContent.length}`
  );

  let copilotResponse;
  try {
    copilotResponse = parseCopilotResponse(responseContent);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
    logger().error(
      `Copilot parse failed: ${errMsg}\nRaw response: ${responseContent.substring(0, 500)}`
    );
    throw err;
  }

  let copilotInteractionId = "" as CopilotInteractionId;

  // Save interaction for authenticated users
  if (!isPublic && req.user) {
    try {
      const mgr = userDbMgr(req);
      const modelType =
        modelProviderOpts.provider === "Anthropic"
          ? "claude"
          : "gpt";
      const interaction = await mgr.createCopilotInteraction({
        projectId,
        userPrompt: goal,
        response: responseContent,
        model: modelType as "gpt" | "claude",
        request: completionRequest,
      });
      copilotInteractionId = interaction.id as CopilotInteractionId;
    } catch (err) {
      // Don't fail the request if interaction logging fails
      logger().warn("Failed to save copilot interaction:", err);
    }
  }

  const result: QueryCopilotUiResponse = {
    data: copilotUiResponseToActions(copilotResponse),
    response: copilotResponse,
    copilotInteractionId,
  };

  res.json(result);
}

export async function copilotUi(
  req: Request,
  res: Response,
  next: NextFunction
) {
  await handleCopilotUi(req, res, next, false);
}

export async function copilotUiPublic(
  req: Request,
  res: Response,
  next: NextFunction
) {
  await handleCopilotUi(req, res, next, true);
}
