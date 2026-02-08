import {
  createAnthropicClient,
  createGeminiClient,
  createOpenAIClient,
} from "@/wab/server/copilot/llms";
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

  const parsed = CopilotUiResponseSchema.parse(JSON.parse(jsonStr));
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

  const userContent = images && images.length > 0
    ? `${goal}\n\n[User also provided ${images.length} reference image(s)]`
    : goal;

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
  const completion = await client.createChatCompletion(completionRequest);

  const responseContent =
    completion.choices?.[0]?.message?.content ?? "";

  const copilotResponse = parseCopilotResponse(responseContent);

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
