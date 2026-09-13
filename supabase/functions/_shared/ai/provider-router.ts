import { NexaError } from "../errors/nexa-error.ts";
import {
  asProviderError,
  ProviderError,
  type ProviderFallbackReason,
  type ProviderRoutingMetadata,
  withProviderRouting,
} from "../errors/provider-error.ts";
import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider.ts";

export interface ProviderRouterOptions {
  primary: AIProvider;
  fallback?: AIProvider;
  allowUnconfiguredPrimaryFallback?: boolean;
}

function missingCredential(provider: AIProvider): ProviderError {
  return new ProviderError({
    kind: "CONFIG_ERROR",
    provider: provider.name,
    configurationIssue: "MISSING_CREDENTIAL",
  });
}

export class ProviderRouter implements AIProvider {
  readonly name = "provider-router";
  readonly model = "dynamic";
  readonly configured = true;

  private readonly primary: AIProvider;
  private readonly fallback?: AIProvider;
  private readonly allowUnconfiguredPrimaryFallback: boolean;

  constructor(options: ProviderRouterOptions) {
    if (options.fallback && options.primary.name === options.fallback.name) {
      throw new NexaError(
        "CONFIGURATION_ERROR",
        "A configuração interna da Nexa é inválida.",
        500,
      );
    }

    this.primary = options.primary;
    this.fallback = options.fallback;
    this.allowUnconfiguredPrimaryFallback = options.allowUnconfiguredPrimaryFallback ?? false;
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (this.primary.configured === false) {
      const error = missingCredential(this.primary);
      if (
        this.allowUnconfiguredPrimaryFallback &&
        this.fallback &&
        this.fallback.configured !== false
      ) {
        return await this.useFallback(request, "PRIMARY_NOT_CONFIGURED");
      }

      throw withProviderRouting(error, {
        primaryProvider: this.primary.name,
        effectiveProvider: this.primary.name,
        fallbackUsed: false,
      });
    }

    try {
      const response = this.validatedResponse(
        await this.primary.generate(request),
        this.primary,
      );
      return this.routedResponse(response, this.primary, false);
    } catch (error) {
      const providerError = asProviderError(error, this.primary.name);
      if (!providerError.fallbackEligible || !this.fallback) {
        throw withProviderRouting(providerError, {
          primaryProvider: this.primary.name,
          effectiveProvider: this.primary.name,
          fallbackUsed: false,
        });
      }

      return await this.useFallback(request, providerError.kind);
    }
  }

  private async useFallback(
    request: AIProviderRequest,
    reason: ProviderFallbackReason,
  ): Promise<AIProviderResponse> {
    const fallback = this.fallback;
    if (!fallback) {
      throw new ProviderError({
        kind: "CONFIG_ERROR",
        provider: this.primary.name,
        configurationIssue: "INVALID_CONFIGURATION",
      });
    }

    const routing: ProviderRoutingMetadata = {
      primaryProvider: this.primary.name,
      effectiveProvider: fallback.name,
      fallbackUsed: true,
      fallbackReason: reason,
    };

    if (fallback.configured === false) {
      throw withProviderRouting(missingCredential(fallback), routing);
    }

    try {
      const response = this.validatedResponse(
        await fallback.generate(request),
        fallback,
      );
      return this.routedResponse(response, fallback, true, reason);
    } catch (error) {
      throw withProviderRouting(asProviderError(error, fallback.name), routing);
    }
  }

  private validatedResponse(
    response: AIProviderResponse,
    provider: AIProvider,
  ): AIProviderResponse {
    if (typeof response?.reply !== "string" || response.reply.trim().length === 0) {
      throw new ProviderError({
        kind: "INVALID_PROVIDER_RESPONSE",
        provider: provider.name,
      });
    }

    return response;
  }

  private routedResponse(
    response: AIProviderResponse,
    provider: AIProvider,
    fallbackUsed: boolean,
    fallbackReason?: ProviderFallbackReason,
  ): AIProviderResponse {
    return {
      ...response,
      provider: provider.name,
      model: provider.model,
      routing: {
        primaryProvider: this.primary.name,
        effectiveProvider: provider.name,
        fallbackUsed,
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  }
}
