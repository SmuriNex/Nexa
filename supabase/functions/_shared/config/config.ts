import { NexaError } from "../errors/nexa-error.ts";

export const NEXA_VERSION = "0.1.0-dev";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GROQ_TIMEOUT_MS = 30_000;

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
  aiProvider: string;
  allowedOrigins: readonly string[];
  groq: {
    apiKey?: string;
    model: string;
    timeoutMs: number;
  };
}

interface DenoRuntime {
  env: EnvironmentReader;
}

function runtimeEnvironment(): EnvironmentReader {
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

function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_GROQ_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new NexaError(
      "CONFIGURATION_ERROR",
      "A configuração interna da Nexa é inválida.",
      500,
    );
  }

  return parsed;
}

function parseOrigins(value: string | undefined): readonly string[] {
  const origins = value
    ? value.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_LOCAL_ORIGINS;

  if (origins.length === 0 || origins.includes("*")) {
    throw new NexaError(
      "CONFIGURATION_ERROR",
      "A configuração interna da Nexa é inválida.",
      500,
    );
  }

  return [...new Set(origins)];
}

export function loadNexaConfig(
  reader: EnvironmentReader = runtimeEnvironment(),
): NexaConfig {
  return {
    environment: optionalValue(reader, "NEXA_ENV") ?? "development",
    version: NEXA_VERSION,
    aiProvider: (optionalValue(reader, "NEXA_AI_PROVIDER") ?? "mock").toLowerCase(),
    allowedOrigins: parseOrigins(optionalValue(reader, "NEXA_ALLOWED_ORIGINS")),
    groq: {
      apiKey: optionalValue(reader, "GROQ_API_KEY"),
      model: optionalValue(reader, "GROQ_MODEL") ?? DEFAULT_GROQ_MODEL,
      timeoutMs: parseTimeout(optionalValue(reader, "GROQ_TIMEOUT_MS")),
    },
  };
}
