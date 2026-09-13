import assert from "node:assert/strict";
import test from "node:test";

import type { AIHistoryMessage } from "../_shared/ai/provider.ts";
import {
  type CommitTurnInput,
  type ConversationRecord,
  ConversationService,
  type ConversationStore,
  HISTORY_MAX_MESSAGES,
  type MessageRecord,
} from "../_shared/conversations/conversation-service.ts";
import type { NexaCore } from "../_shared/core/nexa-core.ts";
import { NexaError } from "../_shared/errors/nexa-error.ts";
import type { ChatData } from "../_shared/types/chat.ts";

const existingId = "512adf75-30c3-4747-b86c-6fb2d60ba038";
const record: ConversationRecord = {
  id: existingId,
  app: "nexa",
  title: "Conversa",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

class FakeStore implements ConversationStore {
  conversation: ConversationRecord | null = record;
  history: AIHistoryMessage[] = [];
  quota = { allowed: true, retryAfterSeconds: 0 };
  commits: CommitTurnInput[] = [];
  quotaCalls: number[] = [];
  historyCalls: Array<{ id: string; limit: number }> = [];

  getConversation(): Promise<ConversationRecord | null> {
    return Promise.resolve(this.conversation);
  }
  getRecentMessages(id: string, limit: number): Promise<AIHistoryMessage[]> {
    this.historyCalls.push({ id, limit });
    return Promise.resolve(this.history);
  }
  consumeRateLimit(maxRequests: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    this.quotaCalls.push(maxRequests);
    return Promise.resolve(this.quota);
  }
  commitTurn(input: CommitTurnInput): Promise<void> {
    this.commits.push(input);
    return Promise.resolve();
  }
  listConversations(): Promise<ConversationRecord[]> {
    return Promise.resolve([]);
  }
  listMessages(): Promise<MessageRecord[]> {
    return Promise.resolve([]);
  }
  deleteConversation(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

interface CoreCall {
  payload: unknown;
  requestId: string;
  history: readonly AIHistoryMessage[];
  conversationId: string;
}

function fakeCore(calls: CoreCall[], fail = false): NexaCore {
  return {
    chat: (
      payload: unknown,
      requestId: string,
      history: readonly AIHistoryMessage[],
      conversationId: string,
    ): Promise<ChatData & { requestId: string }> => {
      calls.push({ payload, requestId, history, conversationId });
      if (fail) {
        return Promise.reject(
          new NexaError("AI_PROVIDER_UNAVAILABLE", "Provider indisponível.", 503),
        );
      }
      return Promise.resolve({
        reply: "Resposta",
        app: "nexa",
        provider: "mock",
        model: "mock",
        requestId,
      });
    },
  } as NexaCore;
}

async function expectError(promise: Promise<unknown>, code: string): Promise<NexaError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof NexaError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Era esperado ${code}.`);
}

test("nova conversa persiste somente o par de mensagens após resposta da IA", async () => {
  const store = new FakeStore();
  const calls: CoreCall[] = [];
  const result = await new ConversationService(store, fakeCore(calls), 6).chat(
    { app: "nexa", message: "  Olá  " },
    "req-new",
  );

  assert.match(result.conversation_id, /^[0-9a-f-]{36}$/);
  assert.equal(result.reply, "Resposta");
  assert.deepEqual(store.quotaCalls, [6]);
  assert.equal(store.historyCalls.length, 0);
  assert.deepEqual(calls[0].history, []);
  assert.deepEqual(store.commits, [{
    conversationId: result.conversation_id,
    createNew: true,
    app: "nexa",
    userContent: "Olá",
    assistantContent: "Resposta",
    provider: "mock",
    model: "mock",
    requestId: "req-new",
  }]);
});

test("conversa existente limita o histórico e o envia ao Core na ordem", async () => {
  const store = new FakeStore();
  store.history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `msg-${index}`,
  }));
  const calls: CoreCall[] = [];
  const result = await new ConversationService(store, fakeCore(calls), 6).chat(
    { app: "nexa", message: "Próxima", conversation_id: existingId },
    "req-existing",
  );

  assert.equal(result.conversation_id, existingId);
  assert.deepEqual(store.historyCalls, [{ id: existingId, limit: HISTORY_MAX_MESSAGES }]);
  assert.deepEqual(calls[0].history.map((item) => item.content), [
    "msg-2",
    "msg-3",
    "msg-4",
    "msg-5",
    "msg-6",
    "msg-7",
    "msg-8",
    "msg-9",
  ]);
  assert.equal(store.commits[0].createNew, false);
  assert.equal(store.commits[0].conversationId, existingId);
});

test("histórico excessivo descarta mensagens antigas antes de chamar a IA", async () => {
  const store = new FakeStore();
  store.history = Array.from({ length: 8 }, (_, index) => ({
    role: "user" as const,
    content: String(index).repeat(2_000),
  }));
  const calls: CoreCall[] = [];
  await new ConversationService(store, fakeCore(calls), 6).chat(
    { app: "nexa", message: "Próxima", conversation_id: existingId },
    "req-bounded",
  );

  assert.equal(calls[0].history.length, 6);
  assert.equal(calls[0].history[0].content[0], "2");
});

test("conversa ausente ou de outro app falha antes de quota e IA", async () => {
  const store = new FakeStore();
  const calls: CoreCall[] = [];
  const service = new ConversationService(store, fakeCore(calls), 6);
  store.conversation = null;
  await expectError(
    service.chat({ app: "nexa", message: "Oi", conversation_id: existingId }, "req-missing"),
    "CONVERSATION_NOT_FOUND",
  );

  store.conversation = { ...record, app: "erp" };
  await expectError(
    service.chat({ app: "nexa", message: "Oi", conversation_id: existingId }, "req-mismatch"),
    "CONVERSATION_APP_MISMATCH",
  );

  assert.deepEqual(store.quotaCalls, []);
  assert.equal(calls.length, 0);
  assert.equal(store.commits.length, 0);
});

test("quota esgotada devolve retry e impede IA e persistência", async () => {
  const store = new FakeStore();
  store.quota = { allowed: false, retryAfterSeconds: 17 };
  const calls: CoreCall[] = [];
  const error = await expectError(
    new ConversationService(store, fakeCore(calls), 6).chat(
      { app: "nexa", message: "Oi" },
      "req-limited",
    ),
    "RATE_LIMITED",
  );

  assert.equal(error.status, 429);
  assert.equal(error.retryAfterSeconds, 17);
  assert.equal(calls.length, 0);
  assert.equal(store.commits.length, 0);
});

test("falha do provider não deixa turno parcial", async () => {
  const store = new FakeStore();
  const calls: CoreCall[] = [];
  await expectError(
    new ConversationService(store, fakeCore(calls, true), 6).chat(
      { app: "nexa", message: "Oi" },
      "req-failure",
    ),
    "AI_PROVIDER_UNAVAILABLE",
  );

  assert.equal(calls.length, 1);
  assert.equal(store.commits.length, 0);
});

test("conversation_id inválido falha antes de quota e acesso ao banco", async () => {
  const store = new FakeStore();
  const calls: CoreCall[] = [];
  await expectError(
    new ConversationService(store, fakeCore(calls), 6).chat(
      { app: "nexa", message: "Oi", conversation_id: "not-a-uuid" },
      "req-invalid",
    ),
    "INVALID_CONVERSATION_ID",
  );

  assert.equal(store.historyCalls.length, 0);
  assert.equal(store.quotaCalls.length, 0);
  assert.equal(calls.length, 0);
});
