export type Provider =
  | "Anthropic"
  | "Cloudflare"
  | "Google"
  | "OpenAI"
  | "VertexAnthropic";

export type ModelProviderOpts = {
  provider: Provider;
  modelName: string;
  maxTokens: number;
  temperature: number;
  options?: {
    openai?: {
      reasoningEffort?: string;
    };
  };
};
