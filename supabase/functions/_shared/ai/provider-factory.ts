import { isDevelopmentEnvironment, type NexaConfig, type ProviderName } from "../config/config.ts";
import { createGeminiProvider } from "./gemini-provider.ts";
import { createGroqProvider } from "./groq-provider.ts";
import { MockProvider } from "./mock-provider.ts";
import type { AIProvider } from "./provider.ts";
import { ProviderRouter } from "./provider-router.ts";

function createProvider(name: ProviderName, config: NexaConfig): AIProvider {
  switch (name) {
    case "mock":
      return new MockProvider();
    case "groq":
      return createGroqProvider(config);
    case "gemini":
      return createGeminiProvider(config);
  }
}

export function createAIProvider(config: NexaConfig): AIProvider {
  return new ProviderRouter({
    primary: createProvider(config.primaryProvider, config),
    ...(config.fallbackProvider
      ? { fallback: createProvider(config.fallbackProvider, config) }
      : {}),
    allowUnconfiguredPrimaryFallback: isDevelopmentEnvironment(config.environment),
  });
}
