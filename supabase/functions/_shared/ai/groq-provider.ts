import type { NexaConfig } from "../config/config.ts";
import { parseRetryAfterSeconds, ProviderError } from "../errors/provider-error.ts";
import { buildProviderUserContent } from "./provider-content.ts";
import type { AIProvider, AIProviderRequest, AIProviderResponse, FetchLike } from "./provider.ts";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqProviderOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

function extractReply(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }

  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return undefined;
  }

  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return undefined;
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return undefined;
  }

  return content.trim();
}

function httpError(response: Response): ProviderError {
  const common = {
    provider: "groq",
    upstreamStatus: response.status,
    retryAfterSeconds: parseRetryAfterSeconds(response.headers),
  } as const;

  if (response.status === 401 || response.status === 403) {
    return new ProviderError({ kind: "AUTH_ERROR", ...common });
  }

  if (response.status === 429) {
    return new ProviderError({ kind: "RATE_LIMITED", ...common });
  }

  if (response.status === 408 || response.status === 504) {
    return new ProviderError({ kind: "TIMEOUT", ...common });
  }

  if (response.status === 404) {
    return new ProviderError({
      kind: "CONFIG_ERROR",
      configurationIssue: "INVALID_MODEL",
      ...common,
    });
  }

  if (response.status === 424 || response.status === 498 || response.status >= 500) {
    return new ProviderError({ kind: "PROVIDER_UNAVAILABLE", ...common });
  }

  return new ProviderError({ kind: "PROVIDER_REJECTED", ...common });
}

function thrownError(error: unknown): ProviderError {
  const name = typeof error === "object" && error !== null && "name" in error
    ? (error as { name?: unknown }).name
    : undefined;
  if (name === "TimeoutError" || name === "AbortError") {
    return new ProviderError({ kind: "TIMEOUT", provider: "groq" });
  }

  if (error instanceof TypeError) {
    return new ProviderError({ kind: "NETWORK_ERROR", provider: "groq" });
  }

  return new ProviderError({ kind: "UNKNOWN_PROVIDER_ERROR", provider: "groq" });
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  readonly model: string;
  readonly configured: boolean;

  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchLike;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation = options.fetch ?? fetch;
    this.configured = Boolean(options.apiKey);
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (!this.apiKey) {
      throw new ProviderError({
        kind: "CONFIG_ERROR",
        provider: this.name,
        configurationIssue: "MISSING_CREDENTIAL",
      });
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: buildProviderUserContent(request) },
          ],
          stream: false,
          tool_choice: "none",
          include_reasoning: false,
          max_completion_tokens: 1024,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw thrownError(error);
    }

    if (!response.ok) {
      throw httpError(response);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const transportError = thrownError(error);
      if (transportError.kind !== "UNKNOWN_PROVIDER_ERROR") {
        throw transportError;
      }
      throw new ProviderError({
        kind: "INVALID_PROVIDER_RESPONSE",
        provider: this.name,
      });
    }

    const reply = extractReply(payload);
    if (!reply) {
      throw new ProviderError({
        kind: "INVALID_PROVIDER_RESPONSE",
        provider: this.name,
      });
    }

    return { reply };
  }
}

export function createGroqProvider(
  config: NexaConfig,
  fetchImplementation?: FetchLike,
): GroqProvider {
  return new GroqProvider({
    apiKey: config.groq.apiKey,
    model: config.groq.model,
    timeoutMs: config.groq.timeoutMs,
    fetch: fetchImplementation,
  });
}
