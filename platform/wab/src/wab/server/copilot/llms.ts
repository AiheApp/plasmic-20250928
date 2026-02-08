/**
 * Wrappers around LLM APIs. Currently just for caching and simple logging.
 */

import { DbMgr } from "@/wab/server/db/DbMgr";
import { logger } from "@/wab/server/observability";
import {
  getAnthropicApiKey,
  getDynamoDbSecrets,
  getGeminiApiKey,
  getOpenaiApiKey,
} from "@/wab/server/secrets";
import { DynamoDbCache, SimpleCache } from "@/wab/server/simple-cache";
import { last, mkShortId } from "@/wab/shared/common";
import {
  ChatCompletionRequestMessageRoleEnum,
  CreateChatCompletionRequest,
  CreateChatCompletionRequestOptions,
  showCompletionRequest,
} from "@/wab/shared/copilot/prompt-utils";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import axios from "axios";
import { createHash } from "crypto";
import OpenAI from "openai";
import { stringify } from "safe-stable-stringify";

export const chatGptDefaultPrompt = `You are ChatGPT, a large language model trained by OpenAI. Follow the user's instructions carefully. Respond using markdown.`;

const openaiApiKey = getOpenaiApiKey();

const anthropicApiKey = getAnthropicApiKey();

const geminiApiKey = getGeminiApiKey();

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

export interface ClaudeAIResponse {
  completion: string;
  stop: string;
  stop_reason: "stop_sequence" | "max_tokens";
  truncated: boolean;
  log_id: string;
  model: string;
  exception?: string;
}

function openAIToAnthropicRole(role: ChatCompletionRequestMessageRoleEnum) {
  if (role === "assistant") {
    return "Assistant" as const;
  }
  return "Human" as const;
}

function anthropicToOpenAIStopReason(reason: "stop_sequence" | "max_tokens") {
  return reason === "max_tokens" ? ("length" as const) : ("stop" as const);
}

export class AnthropicWrapper {
  constructor(private cache: SimpleCache) {}

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

    const prompt =
      createChatCompletionRequest.messages
        .map(
          (message) =>
            `${openAIToAnthropicRole(message.role)}: ${message.content}`
        )
        .join("\n\n") + "\n\nAssistant:";
    const data = {
      prompt,
      model: "claude-v1",
      max_tokens_to_sample: createChatCompletionRequest.max_tokens ?? 5000,
      stop_sequences: ["\n\nHuman:"],
      temperature: createChatCompletionRequest.temperature,
    };

    try {
      const response = await axios.post<ClaudeAIResponse>(
        "https://api.anthropic.com/v1/complete",
        data,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": anthropicApiKey,
          },
        }
      );
      const result = {
        id: `chatcmpl-${mkShortId()}`,
        object: "chat.completion.chunk",
        created: -1,
        model: "gpt-3.5-turbo-0301",
        usage: {
          prompt_tokens: 0,
          completion_tokens: -1, // TODO: Not possible to know number of tokens?
          total_tokens: -1,
        },
        choices: [
          {
            message: {
              role: "assistant",
              content: last(response.data.completion.split("\n\nAssistant:")),
            },
            index: 0,
            ...(response.data.stop_reason
              ? {
                  finish_reason: anthropicToOpenAIStopReason(
                    response.data.stop_reason
                  ),
                }
              : {}),
          },
        ],
      };
      const value1 = stringify(result);
      await this.cache.put(key, value1);
      return JSON.parse(value1);
    } catch (error) {
      logger().error("Error getting chat completions:", error);
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
      logger().error("Error getting Gemini chat completions:", error);
      throw error;
    }
  };
}

export function getOpenAI() {
  return new OpenAI({ apiKey: openaiApiKey });
}

export const createOpenAIClient = (_?: DbMgr) =>
  new OpenAIWrapper(
    getOpenAI(),
    new DynamoDbCache(
      new DynamoDBClient({
        ...(dynamoDbCredentials
          ? {
              credentials: {
                ...dynamoDbCredentials,
              },
            }
          : {}),
        region: "us-west-2",
      })
    )
  );

export const createAnthropicClient = (_?: DbMgr) =>
  new AnthropicWrapper(
    new DynamoDbCache(
      new DynamoDBClient({
        ...(dynamoDbCredentials
          ? {
              credentials: {
                ...dynamoDbCredentials,
              },
            }
          : {}),
        region: "us-west-2",
      })
    )
  );

export const createGeminiClient = (_?: DbMgr) =>
  new GeminiWrapper(
    geminiApiKey ?? "",
    new DynamoDbCache(
      new DynamoDBClient({
        ...(dynamoDbCredentials
          ? {
              credentials: {
                ...dynamoDbCredentials,
              },
            }
          : {}),
        region: "us-west-2",
      })
    )
  );
