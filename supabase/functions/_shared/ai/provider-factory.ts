import type { NexaConfig } from "../config/config.ts";
import { NexaError } from "../errors/nexa-error.ts";
import { createGroqProvider } from "./groq-provider.ts";
import { MockProvider } from "./mock-provider.ts";
import type { AIProvider } from "./provider.ts";

export function createAIProvider(config: NexaConfig): AIProvider {
  switch (config.aiProvider) {
    case "mock":
      return new MockProvider();
    case "groq":
      return createGroqProvider(config);
    default:
      throw new NexaError(
        "AI_PROVIDER_NOT_FOUND",
        "O provedor de IA configurado não é reconhecido.",
        500,
      );
  }
}
