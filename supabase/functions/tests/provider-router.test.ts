import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProvider } from "../_shared/ai/gemini-provider.ts";
import { GroqProvider } from "../_shared/ai/groq-provider.ts";
import { MockProvider } from "../_shared/ai/mock-provider.ts";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
  FetchLike,
} from "../_shared/ai/provider.ts";
import { ProviderRouter } from "../_shared/ai/provider-router.ts";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  loadNexaConfig,
  type NexaConfig,
} from "../_shared/config/config.ts";
import { NexaCore } from "../_shared/core/nexa-core.ts";
import { NexaError } from "../_shared/errors/nexa-error.ts";
import { ProviderError, type ProviderErrorKind } from "../_shared/errors/provider-error.ts";
import type { RequestLog } from "../_shared/logging/logger.ts";

const request: AIProviderRequest = {
  app: "nexa",
  message: "Olá",
  instructions: "Você é Nexa.",
  requestId: "req-router-test",
};

type ProviderBehavior = (
  request: AIProviderRequest,
) => AIProviderResponse | Promise<AIProviderResponse>;

class ScriptedProvider implements AIProvider {
  readonly calls: AIProviderRequest[] = [];
  readonly name: string;
  readonly model: string;
  readonly configured: boolean;
  private readonly behavior: ProviderBehavior;

  constructor(
    name: string,
    model: string,
    behavior: ProviderBehavior,
    configured = true,
  ) {
    this.name = name;
    this.model = model;
    this.behavior = behavior;
    this.configured = configured;
  }

  async generate(input: AIProviderRequest): Promise<AIProviderResponse> {
    this.calls.push(input);
    return await this.behavior(input);
  }
}

function successProvider(name: string, model: string): ScriptedProvider {
  return new ScriptedProvider(name, model, () => ({ reply: `resposta ${name}` }));
}

function failure(kind: ProviderErrorKind, provider: string): ProviderError {
  return new ProviderError({ kind, provider });
}

function config(values: Record<string, string> = {}): NexaConfig {
  const explicitValues = "NEXA_PRIMARY_PROVIDER" in values || "NEXA_AI_PROVIDER" in values
    ? values
    : { NEXA_PRIMARY_PROVIDER: "mock", ...values };
  return loadNexaConfig({ get: (name) => explicitValues[name] });
}

async function captureProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    return error;
  }
  assert.fail("Era esperado ProviderError.");
}

test("Router usa somente o primary quando Groq funciona", async () => {
  const primary = successProvider("groq", DEFAULT_GROQ_MODEL);
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
  const router = new ProviderRouter({ primary, fallback });

  const result = await router.generate(request);

  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 0);
  assert.equal(result.provider, "groq");
  assert.equal(result.model, DEFAULT_GROQ_MODEL);
  assert.deepEqual(result.routing, {
    primaryProvider: "groq",
    effectiveProvider: "groq",
    fallbackUsed: false,
  });
});

test("Router usa Gemini para falhas técnicas elegíveis do Groq", async (t) => {
  const scenarios: Array<{
    name: string;
    kind: ProviderErrorKind;
    fetch: FetchLike;
  }> = [
    {
      name: "rate limit",
      kind: "RATE_LIMITED",
      fetch: () => Promise.resolve(new Response("", { status: 429 })),
    },
    {
      name: "timeout",
      kind: "TIMEOUT",
      fetch: () => Promise.reject(new DOMException("timeout", "TimeoutError")),
    },
    {
      name: "HTTP 5xx",
      kind: "PROVIDER_UNAVAILABLE",
      fetch: () => Promise.resolve(new Response("", { status: 503 })),
    },
    {
      name: "dependência upstream",
      kind: "PROVIDER_UNAVAILABLE",
      fetch: () => Promise.resolve(new Response("", { status: 424 })),
    },
    {
      name: "rede",
      kind: "NETWORK_ERROR",
      fetch: () => Promise.reject(new TypeError("network")),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let primaryCalls = 0;
      const primary = new GroqProvider({
        apiKey: "test-only-groq-key",
        model: DEFAULT_GROQ_MODEL,
        timeoutMs: 30_000,
        fetch: (input, init) => {
          primaryCalls += 1;
          return scenario.fetch(input, init);
        },
      });
      const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
      const result = await new ProviderRouter({ primary, fallback }).generate(request);

      assert.equal(primaryCalls, 1);
      assert.equal(fallback.calls.length, 1);
      assert.equal(result.provider, "gemini");
      assert.equal(result.model, DEFAULT_GEMINI_MODEL);
      assert.equal(result.routing?.fallbackUsed, true);
      assert.equal(result.routing?.fallbackReason, scenario.kind);
    });
  }
});

test("Router não usa fallback para erro de autenticação do Groq", async () => {
  const primary = new GroqProvider({
    apiKey: "test-only-groq-key",
    model: DEFAULT_GROQ_MODEL,
    timeoutMs: 30_000,
    fetch: () => Promise.resolve(new Response("sensitive", { status: 401 })),
  });
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);

  const error = await captureProviderError(
    new ProviderRouter({ primary, fallback }).generate(request),
  );

  assert.equal(error.kind, "AUTH_ERROR");
  assert.equal(error.fallbackEligible, false);
  assert.equal(fallback.calls.length, 0);
  assert.equal(error.routing?.fallbackUsed, false);
});

test("Router trata primary sem chave explicitamente por ambiente", async (t) => {
  await t.test("development usa fallback configurado", async () => {
    const primary = new GroqProvider({
      model: DEFAULT_GROQ_MODEL,
      timeoutMs: 30_000,
    });
    const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
    const result = await new ProviderRouter({
      primary,
      fallback,
      allowUnconfiguredPrimaryFallback: true,
    }).generate(request);

    assert.equal(result.provider, "gemini");
    assert.equal(result.routing?.fallbackReason, "PRIMARY_NOT_CONFIGURED");
    assert.equal(fallback.calls.length, 1);
  });

  await t.test("sem provider configurado retorna erro seguro", async () => {
    const primary = new GroqProvider({
      model: DEFAULT_GROQ_MODEL,
      timeoutMs: 30_000,
    });
    const fallback = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      timeoutMs: 30_000,
    });
    const error = await captureProviderError(new ProviderRouter({
      primary,
      fallback,
      allowUnconfiguredPrimaryFallback: true,
    }).generate(request));

    assert.equal(error.kind, "CONFIG_ERROR");
    assert.equal(error.code, "AI_PROVIDER_NOT_CONFIGURED");
    assert.equal(error.routing?.fallbackUsed, false);
  });

  await t.test("produção não pula primary sem chave", async () => {
    const primary = new GroqProvider({
      model: DEFAULT_GROQ_MODEL,
      timeoutMs: 30_000,
    });
    const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
    const error = await captureProviderError(new ProviderRouter({
      primary,
      fallback,
      allowUnconfiguredPrimaryFallback: false,
    }).generate(request));

    assert.equal(error.kind, "CONFIG_ERROR");
    assert.equal(fallback.calls.length, 0);
  });
});

test("Router executa um GeminiProvider real com fetch injetado no fallback", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("RATE_LIMITED", "groq");
  });
  let geminiCalls = 0;
  const fallback = new GeminiProvider({
    apiKey: "test-only-gemini-key",
    model: DEFAULT_GEMINI_MODEL,
    timeoutMs: 30_000,
    fetch: () => {
      geminiCalls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "resposta Gemini" }] } }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  const result = await new ProviderRouter({ primary, fallback }).generate(request);

  assert.equal(geminiCalls, 1);
  assert.equal(result.reply, "resposta Gemini");
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, DEFAULT_GEMINI_MODEL);
});

test("Router normaliza falha final e nunca cria loop", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("TIMEOUT", "groq");
  });
  const fallback = new ScriptedProvider("gemini", DEFAULT_GEMINI_MODEL, () => {
    throw failure("PROVIDER_UNAVAILABLE", "gemini");
  });

  const error = await captureProviderError(
    new ProviderRouter({ primary, fallback }).generate(request),
  );

  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 1);
  assert.equal(error.kind, "PROVIDER_UNAVAILABLE");
  assert.equal(error.provider, "gemini");
  assert.deepEqual(error.routing, {
    primaryProvider: "groq",
    effectiveProvider: "gemini",
    fallbackUsed: true,
    fallbackReason: "TIMEOUT",
  });
});

test("Router usa fallback para resposta realmente inválida", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => ({ reply: "   " }));
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);

  const result = await new ProviderRouter({ primary, fallback }).generate(request);

  assert.equal(result.provider, "gemini");
  assert.equal(result.routing?.fallbackReason, "INVALID_PROVIDER_RESPONSE");
  assert.equal(fallback.calls.length, 1);

  const failingPrimary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("TIMEOUT", "groq");
  });
  const invalidFallback = new ScriptedProvider(
    "gemini",
    DEFAULT_GEMINI_MODEL,
    () => ({ reply: "" }),
  );
  const error = await captureProviderError(
    new ProviderRouter({
      primary: failingPrimary,
      fallback: invalidFallback,
    }).generate(request),
  );

  assert.equal(error.kind, "INVALID_PROVIDER_RESPONSE");
  assert.equal(error.provider, "gemini");
  assert.equal(failingPrimary.calls.length, 1);
  assert.equal(invalidFallback.calls.length, 1);
  assert.equal(error.routing?.fallbackUsed, true);
  assert.equal(error.routing?.fallbackReason, "TIMEOUT");
});

test("Router não usa fallback para exceção desconhecida", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw new Error("programming detail");
  });
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);

  const error = await captureProviderError(
    new ProviderRouter({ primary, fallback }).generate(request),
  );

  assert.equal(error.kind, "UNKNOWN_PROVIDER_ERROR");
  assert.equal(fallback.calls.length, 0);
});

test("Router preserva erro elegível quando não existe fallback", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("RATE_LIMITED", "groq");
  });

  const error = await captureProviderError(
    new ProviderRouter({ primary }).generate(request),
  );

  assert.equal(error.kind, "RATE_LIMITED");
  assert.equal(error.routing?.fallbackUsed, false);
});

test("MockProvider continua funcionando como escolha explícita", async () => {
  const result = await new ProviderRouter({ primary: new MockProvider() }).generate(request);

  assert.equal(result.provider, "mock");
  assert.equal(result.model, "mock");
  assert.equal(result.routing?.fallbackUsed, false);
});

test("validação do ChatRequest não cria nem chama Router", async () => {
  let factoryCalls = 0;
  const core = new NexaCore(config(), {
    logger: () => undefined,
    providerFactory: () => {
      factoryCalls += 1;
      return new ProviderRouter({ primary: new MockProvider() });
    },
  });

  await assert.rejects(core.chat({ app: "inválido", message: "Olá" }));
  await assert.rejects(core.chat({ app: "nexa", message: "  " }));
  assert.equal(factoryCalls, 0);
});

test("Router preserva request ID no primary, fallback e resposta", async () => {
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("NETWORK_ERROR", "groq");
  });
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
  const coreConfig = config({
    NEXA_PRIMARY_PROVIDER: "groq",
    NEXA_FALLBACK_PROVIDER: "gemini",
  });
  const core = new NexaCore(coreConfig, {
    logger: () => undefined,
    providerFactory: () => new ProviderRouter({ primary, fallback }),
  });

  const result = await core.chat(
    { app: "nexa", message: "Olá" },
    "req-router-preserved",
  );

  assert.equal(primary.calls[0].requestId, "req-router-preserved");
  assert.equal(fallback.calls[0].requestId, "req-router-preserved");
  assert.equal(result.requestId, "req-router-preserved");
  assert.equal(result.provider, "gemini");
});

test("Core registra rota e fallback sem conteúdo sensível", async () => {
  const logs: RequestLog[] = [];
  const primary = new ScriptedProvider("groq", DEFAULT_GROQ_MODEL, () => {
    throw failure("RATE_LIMITED", "groq");
  });
  const fallback = successProvider("gemini", DEFAULT_GEMINI_MODEL);
  const core = new NexaCore(
    config({
      NEXA_PRIMARY_PROVIDER: "groq",
      NEXA_FALLBACK_PROVIDER: "gemini",
    }),
    {
      logger: (entry) => logs.push(entry),
      providerFactory: () => new ProviderRouter({ primary, fallback }),
    },
  );

  await core.chat({
    app: "nexa",
    message: "mensagem-sensível-de-teste",
    context: { dado: "contexto-sensível-de-teste" },
  }, "req-log-router");

  assert.equal(logs.length, 1);
  assert.equal(logs[0].primary_provider, "groq");
  assert.equal(logs[0].provider, "gemini");
  assert.equal(logs[0].fallback_used, true);
  assert.equal(logs[0].fallback_reason, "RATE_LIMITED");
  assert.doesNotMatch(JSON.stringify(logs), /mensagem-sensível|contexto-sensível/);
});

test("configuração preserva alias legado e rejeita conflitos", async (t) => {
  await t.test("alias legado", () => {
    assert.equal(config({ NEXA_AI_PROVIDER: "groq" }).primaryProvider, "groq");
  });

  assert.throws(
    () => loadNexaConfig({ get: () => undefined }),
    (error: unknown) => error instanceof NexaError && error.code === "CONFIGURATION_ERROR",
  );

  const invalidConfigurations: Array<{
    name: string;
    values: Record<string, string>;
  }> = [
    {
      name: "variáveis nova e legada divergentes",
      values: { NEXA_PRIMARY_PROVIDER: "groq", NEXA_AI_PROVIDER: "gemini" },
    },
    {
      name: "primary e fallback iguais",
      values: { NEXA_PRIMARY_PROVIDER: "groq", NEXA_FALLBACK_PROVIDER: "groq" },
    },
    {
      name: "produção sem primary",
      values: { NEXA_ENV: "production" },
    },
    {
      name: "Mock em produção",
      values: { NEXA_ENV: "production", NEXA_PRIMARY_PROVIDER: "mock" },
    },
  ];

  for (const scenario of invalidConfigurations) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => config(scenario.values),
        (error: unknown) => error instanceof NexaError && error.code === "CONFIGURATION_ERROR",
      );
    });
  }
});
