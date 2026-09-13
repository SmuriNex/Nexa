import type { AIHistoryMessage, AIProviderFactory, AIProviderResponse } from "../ai/provider.ts";
import type { NexaConfig } from "../config/config.ts";
import { resolveContext } from "../context/context-resolver.ts";
import { asNexaError, NexaError } from "../errors/nexa-error.ts";
import { ProviderError } from "../errors/provider-error.ts";
import { buildInstructions } from "../instructions/instruction-builder.ts";
import { logRequest, type RequestLogger } from "../logging/logger.ts";
import { resolveRequestId } from "../request/request-id.ts";
import type { ChatData } from "../types/chat.ts";
import { validateChatRequest } from "../validation/chat-request.ts";

export interface NexaCoreDependencies {
  providerFactory: AIProviderFactory;
  logger?: RequestLogger;
}

function normalizeProviderResponse(
  response: AIProviderResponse,
  fallbackProvider: string,
  fallbackModel: string,
): { reply: string; provider: string; model: string } {
  if (typeof response?.reply !== "string" || response.reply.trim().length === 0) {
    throw new NexaError(
      "AI_PROVIDER_INVALID_RESPONSE",
      "O provedor de IA retornou uma resposta inválida.",
      502,
    );
  }

  const provider = response.provider?.trim() || fallbackProvider;
  const model = response.model?.trim() || fallbackModel;
  if (!provider || !model) {
    throw new NexaError(
      "AI_PROVIDER_INVALID_RESPONSE",
      "O provedor de IA retornou uma resposta inválida.",
      502,
    );
  }

  return { reply: response.reply.trim(), provider, model };
}

export class NexaCore {
  private readonly config: NexaConfig;
  private readonly providerFactory: AIProviderFactory;
  private readonly logger: RequestLogger;

  constructor(
    config: NexaConfig,
    dependencies: NexaCoreDependencies,
  ) {
    this.config = config;
    this.providerFactory = dependencies.providerFactory;
    this.logger = dependencies.logger ?? logRequest;
  }

  async chat(
    payload: unknown,
    suppliedRequestId?: string | null,
    history: readonly AIHistoryMessage[] = [],
    conversationId?: string,
  ): Promise<
    ChatData & {
      requestId: string;
    }
  > {
    const requestId = resolveRequestId(suppliedRequestId);
    const startedAt = performance.now();
    let app: string | undefined;

    try {
      const request = validateChatRequest(payload);
      app = request.app;

      const resolvedContext = resolveContext(request.app);
      const instructions = buildInstructions(resolvedContext);
      const provider = this.providerFactory();

      const providerResponse = await provider.generate({
        app: request.app,
        message: request.message,
        instructions,
        context: request.context,
        requestId,
        history,
      });
      const normalized = normalizeProviderResponse(
        providerResponse,
        provider.name,
        provider.model,
      );

      const data: ChatData = {
        reply: normalized.reply,
        app: request.app,
        provider: normalized.provider,
        model: normalized.model,
      };

      this.logger({
        stage: "provider",
        request_id: requestId,
        app,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        primary_provider: providerResponse.routing?.primaryProvider ??
          this.config.primaryProvider,
        provider: normalized.provider,
        fallback_used: providerResponse.routing?.fallbackUsed ?? false,
        ...(providerResponse.routing?.fallbackReason
          ? { fallback_reason: providerResponse.routing.fallbackReason }
          : {}),
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        success: true,
      });

      return { ...data, requestId };
    } catch (error) {
      const safeError = asNexaError(error);
      const routing = error instanceof ProviderError ? error.routing : undefined;
      this.logger({
        stage: "provider",
        request_id: requestId,
        app,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        primary_provider: routing?.primaryProvider ?? this.config.primaryProvider,
        ...(routing?.effectiveProvider ? { provider: routing.effectiveProvider } : {}),
        fallback_used: routing?.fallbackUsed ?? false,
        ...(routing?.fallbackReason ? { fallback_reason: routing.fallbackReason } : {}),
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        success: false,
        error_code: safeError.code,
      });
      throw safeError;
    }
  }
}
