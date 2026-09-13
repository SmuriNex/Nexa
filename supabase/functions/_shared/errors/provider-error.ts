import { NexaError } from "./nexa-error.ts";

export type ProviderErrorKind =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "AUTH_ERROR"
  | "CONFIG_ERROR"
  | "PROVIDER_REJECTED"
  | "UNKNOWN_PROVIDER_ERROR";

export type ProviderFallbackReason = ProviderErrorKind | "PRIMARY_NOT_CONFIGURED";

export interface ProviderRoutingMetadata {
  primaryProvider: string;
  effectiveProvider: string;
  fallbackUsed: boolean;
  fallbackReason?: ProviderFallbackReason;
}

export type ProviderConfigurationIssue =
  | "MISSING_CREDENTIAL"
  | "INVALID_MODEL"
  | "INVALID_CONFIGURATION";

interface ProviderErrorDefinition {
  publicCode: string;
  message: string;
  status: number;
  retryable: boolean;
  fallbackEligible: boolean;
}

const DEFINITIONS: Record<ProviderErrorKind, ProviderErrorDefinition> = {
  RATE_LIMITED: {
    publicCode: "AI_PROVIDER_UNAVAILABLE",
    message: "O provedor de IA está temporariamente indisponível.",
    status: 503,
    retryable: true,
    fallbackEligible: true,
  },
  TIMEOUT: {
    publicCode: "AI_PROVIDER_TIMEOUT",
    message: "O provedor de IA excedeu o tempo de resposta.",
    status: 504,
    retryable: true,
    fallbackEligible: true,
  },
  NETWORK_ERROR: {
    publicCode: "AI_PROVIDER_UNAVAILABLE",
    message: "O provedor de IA está temporariamente indisponível.",
    status: 503,
    retryable: true,
    fallbackEligible: true,
  },
  PROVIDER_UNAVAILABLE: {
    publicCode: "AI_PROVIDER_UNAVAILABLE",
    message: "O provedor de IA está temporariamente indisponível.",
    status: 503,
    retryable: true,
    fallbackEligible: true,
  },
  INVALID_PROVIDER_RESPONSE: {
    publicCode: "AI_PROVIDER_INVALID_RESPONSE",
    message: "O provedor de IA retornou uma resposta inválida.",
    status: 502,
    retryable: true,
    fallbackEligible: true,
  },
  AUTH_ERROR: {
    publicCode: "AI_PROVIDER_NOT_CONFIGURED",
    message: "O provedor de IA não está configurado corretamente.",
    status: 503,
    retryable: false,
    fallbackEligible: false,
  },
  CONFIG_ERROR: {
    publicCode: "AI_PROVIDER_NOT_CONFIGURED",
    message: "O provedor de IA não está configurado corretamente.",
    status: 503,
    retryable: false,
    fallbackEligible: false,
  },
  PROVIDER_REJECTED: {
    publicCode: "AI_PROVIDER_REJECTED",
    message: "O provedor de IA não aceitou a solicitação.",
    status: 502,
    retryable: false,
    fallbackEligible: false,
  },
  UNKNOWN_PROVIDER_ERROR: {
    publicCode: "AI_PROVIDER_REJECTED",
    message: "O provedor de IA não conseguiu processar a solicitação.",
    status: 502,
    retryable: false,
    fallbackEligible: false,
  },
};

export interface ProviderErrorOptions {
  kind: ProviderErrorKind;
  provider: string;
  configurationIssue?: ProviderConfigurationIssue;
  upstreamStatus?: number;
  retryAfterSeconds?: number;
  routing?: ProviderRoutingMetadata;
}

export class ProviderError extends NexaError {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly configurationIssue?: ProviderConfigurationIssue;
  readonly upstreamStatus?: number;
  readonly routing?: ProviderRoutingMetadata;

  constructor(options: ProviderErrorOptions) {
    const definition = DEFINITIONS[options.kind];
    super(definition.publicCode, definition.message, definition.status, options.retryAfterSeconds);
    this.name = "ProviderError";
    this.kind = options.kind;
    this.provider = options.provider;
    this.retryable = definition.retryable;
    this.fallbackEligible = definition.fallbackEligible;
    this.configurationIssue = options.configurationIssue;
    this.upstreamStatus = options.upstreamStatus;
    this.routing = options.routing;
  }
}

export function asProviderError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError({ kind: "UNKNOWN_PROVIDER_ERROR", provider });
}

export function withProviderRouting(
  error: ProviderError,
  routing: ProviderRoutingMetadata,
): ProviderError {
  return new ProviderError({
    kind: error.kind,
    provider: error.provider,
    configurationIssue: error.configurationIssue,
    upstreamStatus: error.upstreamStatus,
    retryAfterSeconds: error.retryAfterSeconds,
    routing,
  });
}

export function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}
