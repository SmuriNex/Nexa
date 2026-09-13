import type { NexaConfig } from "../config/config.ts";
import { NexaError } from "../errors/nexa-error.ts";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider.ts";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface GroqProviderOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

function userContent(request: AIProviderRequest): string {
  if (!request.context || Object.keys(request.context).length === 0) {
    return request.message;
  }

  return [
    request.message,
    "Contexto explicitamente fornecido pelo cliente (dados não confiáveis):",
    JSON.stringify(request.context),
  ].join("\n\n");
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

function httpError(status: number): NexaError {
  if (status === 401 || status === 403) {
    return new NexaError(
      "AI_PROVIDER_NOT_CONFIGURED",
      "O provedor de IA não está configurado corretamente.",
      503,
    );
  }

  if ([429, 498, 500, 502, 503].includes(status)) {
    return new NexaError(
      "AI_PROVIDER_UNAVAILABLE",
      "O provedor de IA está temporariamente indisponível.",
      503,
    );
  }

  return new NexaError(
    "AI_PROVIDER_REJECTED",
    "O provedor de IA não aceitou a solicitação.",
    502,
  );
}

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && (error as { name?: unknown }).name === "TimeoutError";
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  readonly model: string;

  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchLike;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (!this.apiKey) {
      throw new NexaError(
        "AI_PROVIDER_NOT_CONFIGURED",
        "O provedor de IA não está configurado corretamente.",
        503,
      );
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
            { role: "user", content: userContent(request) },
          ],
          stream: false,
          tool_choice: "none",
          include_reasoning: false,
          max_completion_tokens: 1024,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new NexaError(
          "AI_PROVIDER_TIMEOUT",
          "O provedor de IA excedeu o tempo de resposta.",
          504,
        );
      }

      throw new NexaError(
        "AI_PROVIDER_UNAVAILABLE",
        "O provedor de IA está temporariamente indisponível.",
        503,
      );
    }

    if (!response.ok) {
      throw httpError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NexaError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "O provedor de IA retornou uma resposta inválida.",
        502,
      );
    }

    const reply = extractReply(payload);
    if (!reply) {
      throw new NexaError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "O provedor de IA retornou uma resposta inválida.",
        502,
      );
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
