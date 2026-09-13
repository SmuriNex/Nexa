import type { NexaConfig } from "../config/config.ts";
import { parseRetryAfterSeconds, ProviderError } from "../errors/provider-error.ts";
import { buildProviderUserContent } from "./provider-content.ts";
import type { AIProvider, AIProviderRequest, AIProviderResponse, FetchLike } from "./provider.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiProviderOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

const BLOCKING_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlockedResponse(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  const promptFeedback = payload.promptFeedback;
  if (isRecord(promptFeedback)) {
    const blockReason = promptFeedback.blockReason;
    if (
      typeof blockReason === "string" &&
      blockReason.length > 0 &&
      blockReason !== "BLOCK_REASON_UNSPECIFIED"
    ) {
      return true;
    }
  }

  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || !isRecord(candidates[0])) {
    return false;
  }

  const finishReason = candidates[0].finishReason;
  return typeof finishReason === "string" &&
    BLOCKING_FINISH_REASONS.has(finishReason);
}

function extractReply(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return undefined;
  }

  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content)) {
    return undefined;
  }

  const parts = first.content.parts;
  if (!Array.isArray(parts)) {
    return undefined;
  }

  const text = parts
    .filter((part) => isRecord(part) && part.thought !== true)
    .map((part) => part.text)
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim())
    .join("\n")
    .trim();

  return text || undefined;
}

function containsInvalidApiKeyReason(payload: unknown): boolean {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return false;
  }

  const details = payload.error.details;
  return Array.isArray(details) &&
    details.some((detail) => isRecord(detail) && detail.reason === "API_KEY_INVALID");
}

async function httpError(response: Response): Promise<ProviderError> {
  const common = {
    provider: "gemini",
    upstreamStatus: response.status,
    retryAfterSeconds: parseRetryAfterSeconds(response.headers),
  } as const;

  if (response.status === 401 || response.status === 403) {
    return new ProviderError({ kind: "AUTH_ERROR", ...common });
  }

  if (response.status === 400) {
    try {
      if (containsInvalidApiKeyReason(await response.json())) {
        return new ProviderError({ kind: "AUTH_ERROR", ...common });
      }
    } catch {
      // The upstream body is intentionally discarded.
    }
    return new ProviderError({ kind: "PROVIDER_REJECTED", ...common });
  }

  if (response.status === 404) {
    return new ProviderError({
      kind: "CONFIG_ERROR",
      configurationIssue: "INVALID_MODEL",
      ...common,
    });
  }

  if (response.status === 429) {
    return new ProviderError({ kind: "RATE_LIMITED", ...common });
  }

  if (response.status === 408 || response.status === 504) {
    return new ProviderError({ kind: "TIMEOUT", ...common });
  }

  if (response.status >= 500) {
    return new ProviderError({ kind: "PROVIDER_UNAVAILABLE", ...common });
  }

  return new ProviderError({ kind: "PROVIDER_REJECTED", ...common });
}

function thrownError(error: unknown): ProviderError {
  const name = isRecord(error) && typeof error.name === "string" ? error.name : undefined;
  if (name === "TimeoutError" || name === "AbortError") {
    return new ProviderError({ kind: "TIMEOUT", provider: "gemini" });
  }

  if (error instanceof TypeError) {
    return new ProviderError({ kind: "NETWORK_ERROR", provider: "gemini" });
  }

  return new ProviderError({ kind: "UNKNOWN_PROVIDER_ERROR", provider: "gemini" });
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly configured: boolean;

  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchLike;

  constructor(options: GeminiProviderOptions) {
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

    const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent`;
    let response: Response;
    try {
      response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          store: false,
          systemInstruction: {
            parts: [{ text: request.instructions }],
          },
          contents: [{
            role: "user",
            parts: [{ text: buildProviderUserContent(request) }],
          }],
          generationConfig: {
            maxOutputTokens: 1024,
            thinkingConfig: { includeThoughts: false },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw thrownError(error);
    }

    if (!response.ok) {
      throw await httpError(response);
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

    if (isBlockedResponse(payload)) {
      throw new ProviderError({
        kind: "PROVIDER_REJECTED",
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

export function createGeminiProvider(
  config: NexaConfig,
  fetchImplementation?: FetchLike,
): GeminiProvider {
  return new GeminiProvider({
    apiKey: config.gemini.apiKey,
    model: config.gemini.model,
    timeoutMs: config.gemini.timeoutMs,
    fetch: fetchImplementation,
  });
}
