import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider.ts";

export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "mock";
  readonly configured = true;

  generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const historyCount = request.history?.length ?? 0;
    return Promise.resolve({
      reply: `Nexa Mock recebeu sua mensagem no contexto ${request.app}.` +
        (historyCount > 0 ? ` Continuidade: ${historyCount} mensagens anteriores.` : ""),
    });
  }
}
