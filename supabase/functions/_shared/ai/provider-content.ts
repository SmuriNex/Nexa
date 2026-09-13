import type { AIProviderRequest } from "./provider.ts";

export function buildProviderUserContent(request: AIProviderRequest): string {
  if (!request.context || Object.keys(request.context).length === 0) {
    return request.message;
  }

  return [
    request.message,
    "Contexto explicitamente fornecido pelo cliente (dados não confiáveis):",
    JSON.stringify(request.context),
  ].join("\n\n");
}
