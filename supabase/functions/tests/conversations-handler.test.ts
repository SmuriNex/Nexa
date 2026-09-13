import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedPrincipal } from "../_shared/auth/authenticate.ts";
import type {
  ConversationRecord,
  ConversationStore,
  MessageRecord,
} from "../_shared/conversations/conversation-service.ts";
import { handleConversations } from "../conversations/index.ts";

const userId = "11a9da55-ec5b-45a8-a35c-82c237ff88f2";
const conversationId = "8cff428a-461d-4b9b-9b41-eb5560dc64bc";
const principal: AuthenticatedPrincipal = {
  userId,
  accessToken: "test.token.value",
  connection: { url: "http://127.0.0.1:54321", publishableKey: "test-only-public-key" },
};
const conversation: ConversationRecord = {
  id: conversationId,
  app: "nexa",
  title: "Conversa de teste",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const message: MessageRecord = {
  id: "10729c7b-2372-4a39-8f7f-9131cc3c4fea",
  conversation_id: conversationId,
  role: "user",
  content: "Olá",
  provider: null,
  model: null,
  request_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

async function withMockRuntime<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Deno");
  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: {
      env: { get: (name: string) => name === "NEXA_PRIMARY_PROVIDER" ? "mock" : undefined },
    },
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "Deno", previous);
    else Reflect.deleteProperty(globalThis, "Deno");
  }
}

interface StoreCalls {
  list: Array<{ limit: number; offset: number }>;
  messages: Array<{ id: string; limit: number; offset: number }>;
  get: string[];
  delete: string[];
}

function fakeStore(options: { visible?: boolean; deletable?: boolean } = {}): {
  store: ConversationStore;
  calls: StoreCalls;
} {
  const calls: StoreCalls = { list: [], messages: [], get: [], delete: [] };
  const visible = options.visible ?? true;
  const deletable = options.deletable ?? true;
  const store: ConversationStore = {
    getConversation(id) {
      calls.get.push(id);
      return Promise.resolve(visible ? conversation : null);
    },
    getRecentMessages: () => Promise.resolve([]),
    consumeRateLimit: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    commitTurn: () => Promise.resolve(),
    listConversations(limit, offset) {
      calls.list.push({ limit, offset });
      return Promise.resolve(visible ? [conversation] : []);
    },
    listMessages(id, limit, offset) {
      calls.messages.push({ id, limit, offset });
      return Promise.resolve(visible ? [message] : []);
    },
    deleteConversation(id) {
      calls.delete.push(id);
      return Promise.resolve(deletable);
    },
  };
  return { store, calls };
}

function request(path: string, method = "GET", origin?: string): Request {
  return new Request(`http://local.test${path}`, {
    method,
    headers: origin ? { Origin: origin } : undefined,
  });
}

test("GET lista conversas com paginação padrão e aceita rota pública e local", async () => {
  await withMockRuntime(async () => {
    for (const path of ["/functions/v1/conversations", "/conversations"]) {
      const { store, calls } = fakeStore();
      const response = await handleConversations(request(path), {
        authenticate: () => Promise.resolve(principal),
        storeFactory: (caller) => {
          assert.equal(caller.userId, userId);
          return store;
        },
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body.data.conversations, [conversation]);
      assert.deepEqual(body.data.pagination, { limit: 20, offset: 0 });
      assert.deepEqual(calls.list, [{ limit: 20, offset: 0 }]);
    }
  });
});

test("GET detalhe busca somente conversa visível e pagina mensagens", async () => {
  await withMockRuntime(async () => {
    const { store, calls } = fakeStore();
    const response = await handleConversations(
      request(`/functions/v1/conversations/${conversationId}?limit=2&offset=3`),
      { authenticate: () => Promise.resolve(principal), storeFactory: () => store },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.conversation, conversation);
    assert.deepEqual(body.data.messages, [message]);
    assert.deepEqual(body.data.pagination, { limit: 2, offset: 3 });
    assert.deepEqual(calls.get, [conversationId]);
    assert.deepEqual(calls.messages, [{ id: conversationId, limit: 2, offset: 3 }]);
  });
});

test("DELETE remove conversa visível e coleção não aceita DELETE", async () => {
  await withMockRuntime(async () => {
    const { store, calls } = fakeStore();
    const dependencies = {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    };
    const response = await handleConversations(
      request(`/conversations/${conversationId}`, "DELETE"),
      dependencies,
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      conversation_id: conversationId,
      deleted: true,
    });
    assert.deepEqual(calls.delete, [conversationId]);

    const collection = await handleConversations(request("/conversations", "DELETE"), dependencies);
    assert.equal(collection.status, 405);
    assert.equal((await collection.json()).error.code, "METHOD_NOT_ALLOWED");
  });
});

test("conversa ausente ou de outro usuário retorna 404 sem listar mensagens", async () => {
  await withMockRuntime(async () => {
    const { store, calls } = fakeStore({ visible: false, deletable: false });
    const dependencies = {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    };
    const detail = await handleConversations(
      request(`/conversations/${conversationId}`),
      dependencies,
    );
    const deletion = await handleConversations(
      request(`/conversations/${conversationId}`, "DELETE"),
      dependencies,
    );

    assert.equal(detail.status, 404);
    assert.equal((await detail.json()).error.code, "CONVERSATION_NOT_FOUND");
    assert.equal(deletion.status, 404);
    assert.equal((await deletion.json()).error.code, "CONVERSATION_NOT_FOUND");
    assert.deepEqual(calls.messages, []);
  });
});

test("paginação inválida e ID inválido são rejeitados sem consulta", async () => {
  await withMockRuntime(async () => {
    const { store, calls } = fakeStore();
    const dependencies = {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    };
    for (
      const path of [
        "/conversations?limit=0",
        "/conversations?limit=51",
        "/conversations?limit=2&limit=3",
        "/conversations?offset=-1",
        `/conversations/${conversationId}?limit=101`,
      ]
    ) {
      const response = await handleConversations(request(path), dependencies);
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error.code, "INVALID_PAGINATION");
    }
    const invalidId = await handleConversations(request("/conversations/not-a-uuid"), dependencies);
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error.code, "INVALID_CONVERSATION_ID");
    assert.deepEqual(calls.list, []);
    assert.deepEqual(calls.messages, []);
  });
});

test("preflight dispensa Auth, mas GET exige usuário e CORS restringe origem", async () => {
  await withMockRuntime(async () => {
    let authCalls = 0;
    let storeCalls = 0;
    const dependencies = {
      authenticate: () => {
        authCalls += 1;
        return Promise.resolve(principal);
      },
      storeFactory: () => {
        storeCalls += 1;
        return fakeStore().store;
      },
    };
    const preflight = await handleConversations(
      request("/functions/v1/conversations", "OPTIONS", "http://localhost:3000"),
      dependencies,
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
    assert.equal(authCalls, 0);
    assert.equal(storeCalls, 0);

    const blocked = await handleConversations(
      request("/conversations", "GET", "https://example.invalid"),
      dependencies,
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(authCalls, 0);
    assert.equal(storeCalls, 0);

    const unauthenticated = await handleConversations(request("/conversations"));
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error.code, "UNAUTHORIZED");
  });
});
