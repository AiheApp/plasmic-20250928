/**
 * Wrappers around LLM APIs. Currently just for caching and simple logging.
 */

import { DbMgr } from "@/wab/server/db/DbMgr";
import { logger } from "@/wab/server/observability";
import {
  getAnthropicApiKey,
  getCloudflareAccountId,
  getCloudflareApiToken,
  getDynamoDbSecrets,
  getGeminiApiKey,
  getOpenaiApiKey,
} from "@/wab/server/secrets";
import { DynamoDbCache, NoopCache, SimpleCache } from "@/wab/server/simple-cache";
import { mkShortId } from "@/wab/shared/common";
import {
  CreateChatCompletionRequest,
  CreateChatCompletionRequestOptions,
  showCompletionRequest,
} from "@/wab/shared/copilot/prompt-utils";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { createHash } from "crypto";
import OpenAI from "openai";
import { stringify } from "safe-stable-stringify";

export const chatGptDefaultPrompt = `You are ChatGPT, a large language model trained by OpenAI. Follow the user's instructions carefully. Respond using markdown.`;

const openaiApiKey = getOpenaiApiKey();

const anthropicApiKey = getAnthropicApiKey();

const geminiApiKey = getGeminiApiKey();

const cloudflareAccountId = getCloudflareAccountId();
const cloudflareApiToken = getCloudflareApiToken();

const dynamoDbCredentials = getDynamoDbSecrets();

const verbose = false;

const hash = (x: string) => createHash("sha256").update(x).digest("hex");

export class OpenAIWrapper {
  constructor(private openai: OpenAI, private cache: SimpleCache) {}

  createChatCompletion = async (
    createChatCompletionRequest: CreateChatCompletionRequest,
    options?: CreateChatCompletionRequestOptions
  ) => {
    if (verbose) {
      logger().debug(showCompletionRequest(createChatCompletionRequest));
    }
    const key = hash(
      JSON.stringify([
        "OpenAI.createChatCompletion",
        createChatCompletionRequest,
        options,
      ])
    );
    const value = await this.cache.get(key);
    if (value) {
      return JSON.parse(value);
    }
    const result = await this.openai.chat.completions.create(
      createChatCompletionRequest,
      options
    );

    const value1 = stringify(result);
    await this.cache.put(key, value1);
    return JSON.parse(value1);
  };
}

interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: { type: "text"; text: string }[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicWrapper {
  constructor(private apiKey: string, private cache: SimpleCache) {}

  createChatCompletion = async (
    createChatCompletionRequest: CreateChatCompletionRequest,
    options?: CreateChatCompletionRequestOptions
  ) => {
    if (verbose) {
      logger().info(showCompletionRequest(createChatCompletionRequest));
    }
    const key = hash(
      JSON.stringify([
        "Anthropic.createChatCompletion",
        createChatCompletionRequest,
        options,
      ])
    );
    const value = await this.cache.get(key);
    if (value) {
      return JSON.parse(value);
    }

    const systemMessages = createChatCompletionRequest.messages.filter(
      (m) => m.role === "system"
    );
    const nonSystemMessages = createChatCompletionRequest.messages.filter(
      (m) => m.role !== "system"
    );

    const systemText = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n\n");

    const messages = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as unknown as Array<Record<string, unknown>>).map((part) => {
              if ((part as any).type === "image_url") {
                // Convert OpenAI image_url format to Anthropic image format
                const url = (part as any).image_url?.url as string;
                const dataUriMatch = url?.match(
                  /^data:(image\/[^;]+);base64,(.+)$/
                );
                if (dataUriMatch) {
                  return {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: dataUriMatch[1],
                      data: dataUriMatch[2],
                    },
                  };
                }
                // Fall back to URL-based image
                return {
                  type: "image" as const,
                  source: { type: "url" as const, url },
                };
              }
              return part;
            })
          : "",
    }));

    const body: Record<string, unknown> = {
      model: createChatCompletionRequest.model,
      max_tokens: createChatCompletionRequest.max_tokens ?? 8192,
      messages,
    };
    // Newer Claude models (e.g. Opus 4.8) deprecate the `temperature` param and
    // return 400 if it's sent. Only include it for models that still accept it.
    const modelName = createChatCompletionRequest.model ?? "";
    const temperatureDeprecated = /claude-opus-4-([89]|\d\d)/.test(modelName);
    if (!temperatureDeprecated) {
      body.temperature = createChatCompletionRequest.temperature ?? 0;
    }
    if (systemText) {
      body.system = systemText;
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Anthropic API error ${response.status}: ${errorText}`
        );
      }

      const data: AnthropicMessagesResponse = await response.json();

      const contentText =
        data.content?.map((c) => c.text).join("") ?? "";
      const mappedFinishReason =
        data.stop_reason === "max_tokens" ? "length" : "stop";

      const result = {
        id: `chatcmpl-${mkShortId()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: data.model,
        usage: {
          prompt_tokens: data.usage?.input_tokens ?? 0,
          completion_tokens: data.usage?.output_tokens ?? 0,
          total_tokens:
            (data.usage?.input_tokens ?? 0) +
            (data.usage?.output_tokens ?? 0),
        },
        choices: [
          {
            message: {
              role: "assistant",
              content: contentText,
            },
            index: 0,
            finish_reason: mappedFinishReason,
          },
        ],
      };
      const value1 = stringify(result);
      await this.cache.put(key, value1);
      return JSON.parse(value1);
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      logger().error(`Error getting Anthropic chat completions: ${errMsg}`);
      throw error;
    }
  };
}

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates?: {
    content: { parts: { text: string }[] };
    finishReason: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiWrapper {
  constructor(private apiKey: string, private cache: SimpleCache) {}

  createChatCompletion = async (
    createChatCompletionRequest: CreateChatCompletionRequest,
    _options?: CreateChatCompletionRequestOptions
  ) => {
    if (verbose) {
      logger().info(showCompletionRequest(createChatCompletionRequest));
    }
    const key = hash(
      JSON.stringify([
        "Gemini.createChatCompletion",
        createChatCompletionRequest,
        _options,
      ])
    );
    const value = await this.cache.get(key);
    if (value) {
      return JSON.parse(value);
    }

    const systemMessages = createChatCompletionRequest.messages.filter(
      (m) => m.role === "system"
    );
    const nonSystemMessages = createChatCompletionRequest.messages.filter(
      (m) => m.role !== "system"
    );

    const systemInstruction =
      systemMessages.length > 0
        ? {
            parts: systemMessages.map((m) => ({
              text: typeof m.content === "string" ? m.content : "",
            })),
          }
        : undefined;

    const contents: GeminiContent[] = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        { text: typeof m.content === "string" ? m.content : "" },
      ],
    }));

    const modelName = createChatCompletionRequest.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: createChatCompletionRequest.max_tokens ?? 8192,
        temperature: createChatCompletionRequest.temperature ?? 0,
      },
    };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini API error ${response.status}: ${errorText}`
        );
      }

      const data: GeminiResponse = await response.json();

      const candidateText =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const finishReason = data.candidates?.[0]?.finishReason ?? "STOP";

      const mappedFinishReason =
        finishReason === "MAX_TOKENS" ? "length" : "stop";

      const result = {
        id: `chatcmpl-${mkShortId()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
        choices: [
          {
            message: {
              role: "assistant",
              content: candidateText,
            },
            index: 0,
            finish_reason: mappedFinishReason,
          },
        ],
      };

      const value1 = stringify(result);
      await this.cache.put(key, value1);
      return JSON.parse(value1);
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      logger().error(`Error getting Gemini chat completions: ${errMsg}`);
      throw error;
    }
  };
}

export function getOpenAI() {
  return new OpenAI({ apiKey: openaiApiKey });
}

function createCache(): SimpleCache {
  if (!dynamoDbCredentials) {
    return new NoopCache();
  }
  return new DynamoDbCache(
    new DynamoDBClient({
      credentials: { ...dynamoDbCredentials },
      region: "us-west-2",
    })
  );
}

export const createOpenAIClient = (_?: DbMgr) =>
  new OpenAIWrapper(getOpenAI(), createCache());

export const createAnthropicClient = (_?: DbMgr) =>
  new AnthropicWrapper(anthropicApiKey ?? "", createCache());

export const createGeminiClient = (_?: DbMgr) =>
  new GeminiWrapper(geminiApiKey ?? "", createCache());

function getCloudflareOpenAI() {
  return new OpenAI({
    apiKey: cloudflareApiToken ?? "",
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1`,
  });
}

export const createCloudflareClient = (_?: DbMgr) =>
  new OpenAIWrapper(getCloudflareOpenAI(), createCache());
