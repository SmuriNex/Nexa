import { type EnvironmentReader, runtimeEnvironment } from "../config/config.ts";
import { NexaError } from "../errors/nexa-error.ts";
import { isUuid } from "../validation/uuid.ts";
import type { FetchLike } from "../ai/provider.ts";

export interface SupabaseConnection {
  url: string;
  publishableKey: string;
  serviceRoleKey?: string;
}

export interface AuthenticatedPrincipal {
  userId: string;
  accessToken: string;
  connection: SupabaseConnection;
}

const BEARER_JWT = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

function unauthorized(): NexaError {
  return new NexaError("UNAUTHORIZED", "Autenticação obrigatória ou inválida.", 401);
}

function authUnavailable(): NexaError {
  return new NexaError(
    "AUTH_UNAVAILABLE",
    "A autenticação está temporariamente indisponível.",
    503,
  );
}

export function readSupabaseConnection(
  reader: EnvironmentReader = runtimeEnvironment(),
): SupabaseConnection {
  const rawUrl = reader.get("SUPABASE_URL")?.trim();
  const publishableKey = reader.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    reader.get("SUPABASE_ANON_KEY")?.trim();
  const serviceRoleKey = reader.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!rawUrl || !publishableKey) {
    throw new NexaError("CONFIGURATION_ERROR", "A configuração interna da Nexa é inválida.", 500);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NexaError("CONFIGURATION_ERROR", "A configuração interna da Nexa é inválida.", 500);
  }

  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash
  ) {
    throw new NexaError("CONFIGURATION_ERROR", "A configuração interna da Nexa é inválida.", 500);
  }

  return {
    url: url.origin,
    publishableKey,
    ...(serviceRoleKey ? { serviceRoleKey } : {}),
  };
}

export async function authenticateRequest(
  request: Request,
  options: {
    reader?: EnvironmentReader;
    fetch?: FetchLike;
  } = {},
): Promise<AuthenticatedPrincipal> {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 16_384) throw unauthorized();
  const match = BEARER_JWT.exec(authorization);
  if (!match) throw unauthorized();

  const connection = readSupabaseConnection(options.reader);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${connection.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: connection.publishableKey,
        Authorization: `Bearer ${match[1]}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw authUnavailable();
  }

  if (response.status === 401 || response.status === 403) throw unauthorized();
  if (!response.ok) throw authUnavailable();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw authUnavailable();
  }

  if (
    typeof body !== "object" || body === null || !("id" in body) ||
    !isUuid(body.id)
  ) {
    throw authUnavailable();
  }

  return { userId: body.id, accessToken: match[1], connection };
}
