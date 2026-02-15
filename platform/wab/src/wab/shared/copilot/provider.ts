export type Provider = "Anthropic" | "Cloudflare" | "Google" | "OpenAI";

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
