import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider.ts";

export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "mock";

  generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    return Promise.resolve({
      reply: `Nexa Mock recebeu sua mensagem no contexto ${request.app}.`,
    });
  }
}
