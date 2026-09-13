import { NexaError } from "../errors/nexa-error.ts";

export const NEXA_VERSION = "0.1.0-dev";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 6;
export const PROVIDER_NAMES = ["mock", "groq", "gemini"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

const DEFAULT_LOCAL_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface NexaConfig {
  environment: string;
  version: string;
  primaryProvider: ProviderName;
  fallbackProvider?: ProviderName;
  rateLimitPerMinute: number;
  allowedOrigins: readonly string[];
  groq: {
    apiKey?: string;
    model: string;
    timeoutMs: number;
  };
  gemini: {
    apiKey?: string;
    model: string;
    timeoutMs: number;
  };
}

interface DenoRuntime {
  env: EnvironmentReader;
}

export function runtimeEnvironment(): EnvironmentReader {
  const runtime = globalThis as typeof globalThis & { Deno?: DenoRuntime };

  return {
    get(name: string): string | undefined {
      return runtime.Deno?.env.get(name);
    },
  };
}

function optionalValue(reader: EnvironmentReader, name: string): string | undefined {
  const value = reader.get(name)?.trim();
  return value ? value : undefined;
}

function configurationError(): NexaError {
  return new NexaError(
    "CONFIGURATION_ERROR",
    "A configuração interna da Nexa é inválida.",
    500,
  );
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw configurationError();
  }

  return parsed;
}

function parseRateLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw configurationError();
  }
  return parsed;
}

function parseOrigins(value: string | undefined): readonly string[] {
  const origins = value
    ? value.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_LOCAL_ORIGINS;

  if (origins.length === 0 || origins.includes("*")) {
    throw configurationError();
  }

  return [...new Set(origins)];
}

function parseProvider(value: string): ProviderName {
  const provider = value.toLowerCase();
  if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
    throw configurationError();
  }
  return provider as ProviderName;
}

export function isDevelopmentEnvironment(environment: string): boolean {
  return environment === "development" || environment === "test";
}

export function loadNexaConfig(
  reader: EnvironmentReader = runtimeEnvironment(),
): NexaConfig {
  const environment = (optionalValue(reader, "NEXA_ENV") ?? "development").toLowerCase();
  const configuredPrimary = optionalValue(reader, "NEXA_PRIMARY_PROVIDER");
  const legacyPrimary = optionalValue(reader, "NEXA_AI_PROVIDER");

  if (
    configuredPrimary &&
    legacyPrimary &&
    configuredPrimary.toLowerCase() !== legacyPrimary.toLowerCase()
  ) {
    throw configurationError();
  }

  const primaryValue = configuredPrimary ?? legacyPrimary;
  if (!primaryValue) {
    throw configurationError();
  }

  const primaryProvider = parseProvider(primaryValue);
  const fallbackValue = optionalValue(reader, "NEXA_FALLBACK_PROVIDER");
  const fallbackProvider = fallbackValue ? parseProvider(fallbackValue) : undefined;

  if (
    primaryProvider === fallbackProvider ||
    (!isDevelopmentEnvironment(environment) &&
      (primaryProvider === "mock" || fallbackProvider === "mock"))
  ) {
    throw configurationError();
  }

  return {
    environment,
    version: NEXA_VERSION,
    primaryProvider,
    ...(fallbackProvider ? { fallbackProvider } : {}),
    rateLimitPerMinute: parseRateLimit(optionalValue(reader, "NEXA_RATE_LIMIT_PER_MINUTE")),
    allowedOrigins: parseOrigins(optionalValue(reader, "NEXA_ALLOWED_ORIGINS")),
    groq: {
      apiKey: optionalValue(reader, "GROQ_API_KEY"),
      model: optionalValue(reader, "GROQ_MODEL") ?? DEFAULT_GROQ_MODEL,
      timeoutMs: parseTimeout(optionalValue(reader, "GROQ_TIMEOUT_MS")),
    },
    gemini: {
      apiKey: optionalValue(reader, "GEMINI_API_KEY"),
      model: optionalValue(reader, "GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL,
      timeoutMs: parseTimeout(optionalValue(reader, "GEMINI_TIMEOUT_MS")),
    },
  };
}
