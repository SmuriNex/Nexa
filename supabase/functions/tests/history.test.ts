import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProvider } from "../_shared/ai/gemini-provider.ts";
import { GroqProvider } from "../_shared/ai/groq-provider.ts";
import type { AIProvider, AIProviderRequest } from "../_shared/ai/provider.ts";
import { loadNexaConfig } from "../_shared/config/config.ts";
import { NexaCore } from "../_shared/core/nexa-core.ts";
import type { RequestLog } from "../_shared/logging/logger.ts";

const history = [
  { role: "user" as const, content: "Primeira pergunta" },
  { role: "assistant" as const, content: "Primeira resposta" },
];
const request: AIProviderRequest = {
  app: "nexa",
  message: "Segunda pergunta",
  instructions: "Identidade Nexa",
  requestId: "req-history",
  history,
};

test("Groq recebe sistema, histórico e mensagem atual nesta ordem", async () => {
  let body: Record<string, unknown> = {};
  const provider = new GroqProvider({
    apiKey: "test-only-groq-key",
    model: "test-model",
    timeoutMs: 30_000,
    fetch: (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Resposta" } }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  await provider.generate(request);

  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(messages.map((item) => item.role), ["system", "user", "assistant", "user"]);
  assert.equal(messages[0].content, request.instructions);
  assert.equal(messages[1].content, history[0].content);
  assert.equal(messages[2].content, history[1].content);
  assert.match(messages[3].content, /Segunda pergunta/);
});

test("Gemini converte assistant em model sem misturar a mensagem atual", async () => {
  let body: Record<string, unknown> = {};
  const provider = new GeminiProvider({
    apiKey: "test-only-gemini-key",
    model: "test-model",
    timeoutMs: 30_000,
    fetch: (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Resposta" }] } }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  await provider.generate(request);

  const contents = body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
  assert.deepEqual(contents.map((item) => item.role), ["user", "model", "user"]);
  assert.equal(contents[0].parts[0].text, history[0].content);
  assert.equal(contents[1].parts[0].text, history[1].content);
  assert.match(contents[2].parts[0].text, /Segunda pergunta/);
  assert.equal(
    (body.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text,
    request.instructions,
  );
});

test("Core encaminha histórico ao provider e registra somente ID da conversa", async () => {
  const calls: AIProviderRequest[] = [];
  const logs: RequestLog[] = [];
  const provider: AIProvider = {
    name: "stub",
    model: "stub-model",
    generate(input) {
      calls.push(input);
      return Promise.resolve({ reply: "Resposta" });
    },
  };
  const config = loadNexaConfig({
    get: (name) => name === "NEXA_PRIMARY_PROVIDER" ? "mock" : undefined,
  });
  const core = new NexaCore(config, {
    providerFactory: () => provider,
    logger: (entry) => logs.push(entry),
  });
  const conversationId = "99a541c5-2c6d-43bd-893f-3bc676529fe6";

  const result = await core.chat(
    { app: "nexa", message: "Segunda pergunta" },
    "req-history-core",
    history,
    conversationId,
  );

  assert.equal(result.reply, "Resposta");
  assert.deepEqual(calls[0].history, history);
  assert.equal(logs[0].conversation_id, conversationId);
  assert.doesNotMatch(JSON.stringify(logs), /Primeira pergunta|Primeira resposta|Segunda pergunta/);
});
