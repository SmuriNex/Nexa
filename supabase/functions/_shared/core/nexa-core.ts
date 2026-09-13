import type { AIProviderFactory, AIProviderResponse } from "../ai/provider.ts";
import type { NexaConfig } from "../config/config.ts";
import { resolveContext } from "../context/context-resolver.ts";
import { asNexaError, NexaError } from "../errors/nexa-error.ts";
import { buildInstructions } from "../instructions/instruction-builder.ts";
import { logRequest, type RequestLogger } from "../logging/logger.ts";
import { resolveRequestId } from "../request/request-id.ts";
import type { ChatData } from "../types/chat.ts";
import { validateChatRequest } from "../validation/chat-request.ts";

export interface NexaCoreDependencies {
  providerFactory: AIProviderFactory;
  logger?: RequestLogger;
}

function normalizeProviderResponse(response: AIProviderResponse): string {
  if (typeof response?.reply !== "string" || response.reply.trim().length === 0) {
    throw new NexaError(
      "AI_PROVIDER_INVALID_RESPONSE",
      "O provedor de IA retornou uma resposta inválida.",
      502,
    );
  }

  return response.reply.trim();
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

  async chat(payload: unknown, suppliedRequestId?: string | null): Promise<
    ChatData & {
      requestId: string;
    }
  > {
    const requestId = resolveRequestId(suppliedRequestId);
    const startedAt = performance.now();
    let app: string | undefined;
    let providerName: string | undefined;

    try {
      const request = validateChatRequest(payload);
      app = request.app;

      const resolvedContext = resolveContext(request.app);
      const instructions = buildInstructions(resolvedContext);
      const provider = this.providerFactory();
      providerName = provider.name;

      const providerResponse = await provider.generate({
        app: request.app,
        message: request.message,
        instructions,
        context: request.context,
        requestId,
      });

      const data: ChatData = {
        reply: normalizeProviderResponse(providerResponse),
        app: request.app,
        provider: provider.name,
        model: provider.model,
      };

      this.logger({
        request_id: requestId,
        app,
        provider: providerName,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        success: true,
      });

      return { ...data, requestId };
    } catch (error) {
      const safeError = asNexaError(error);
      this.logger({
        request_id: requestId,
        app,
        provider: providerName ?? this.config.aiProvider,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        success: false,
        error_code: safeError.code,
      });
      throw safeError;
    }
  }
}
