import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedPrincipal } from "../_shared/auth/authenticate.ts";
import type {
  CreateMemoryInput,
  MemoryRecord,
  MemoryStore,
  UpdateMemoryInput,
} from "../_shared/memories/types.ts";
import { handleMemories } from "../memories/index.ts";

const memoryId = "781db05f-4f34-45b8-bd24-b6ed794519f5";
const principal: AuthenticatedPrincipal = {
  userId: "729a595f-0ac2-49dd-ad04-b3cdf7e4122b",
  accessToken: "test.token.value",
  connection: {
    url: "http://127.0.0.1:54321",
    publishableKey: "test-only-public-key",
    serviceRoleKey: "must-not-be-used-for-memory",
  },
};

const initial: MemoryRecord = {
  id: memoryId,
  scope: "global",
  app: null,
  category: "preference",
  content: "Prefere respostas curtas",
  source: "user_explicit",
  created_at: "2026-09-13T12:00:00Z",
  updated_at: "2026-09-13T12:00:00Z",
};

class FakeMemoryStore implements MemoryStore {
  memory: MemoryRecord | null = initial;
  creates: CreateMemoryInput[] = [];
  updates: Array<{ id: string; input: UpdateMemoryInput }> = [];
  deletes: string[] = [];
  pages: Array<{ limit: number; offset: number }> = [];

  getMemory(): Promise<MemoryRecord | null> {
    return Promise.resolve(this.memory);
  }
  listMemories(limit: number, offset: number): Promise<MemoryRecord[]> {
    this.pages.push({ limit, offset });
    return Promise.resolve(this.memory ? [this.memory] : []);
  }
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    this.creates.push(input);
    this.memory = { ...initial, ...input };
    return Promise.resolve(this.memory);
  }
  updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    this.updates.push({ id, input });
    this.memory = this.memory ? { ...this.memory, ...input } : null;
    return Promise.resolve(this.memory);
  }
  deleteMemory(id: string): Promise<boolean> {
    this.deletes.push(id);
    return Promise.resolve(this.memory?.id === id);
  }
  listForChat(): Promise<[]> {
    return Promise.resolve([]);
  }
}

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

function jsonRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`http://local.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("Memory API lista, cria, altera e exclui memória explícita", async () => {
  await withMockRuntime(async () => {
    const store = new FakeMemoryStore();
    const dependencies = {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    };

    const list = await handleMemories(
      jsonRequest("GET", "/functions/v1/memories?limit=7&offset=2"),
      dependencies,
    );
    assert.equal(list.status, 200);
    assert.deepEqual(store.pages, [{ limit: 7, offset: 2 }]);
    assert.equal((await list.json()).data.memories[0].id, memoryId);

    const created = await handleMemories(
      jsonRequest("POST", "/memories", {
        scope: "global",
        app: null,
        category: "fact",
        content: "  Mora em São Paulo  ",
      }),
      dependencies,
    );
    assert.equal(created.status, 201);
    assert.deepEqual(store.creates, [{
      scope: "global",
      app: null,
      category: "fact",
      content: "Mora em São Paulo",
    }]);
    assert.equal((await created.json()).data.memory.source, "user_explicit");

    const updated = await handleMemories(
      jsonRequest("PATCH", `/memories/${memoryId}`, {
        scope: "app",
        app: "erp",
        category: "instruction",
      }),
      dependencies,
    );
    assert.equal(updated.status, 200);
    assert.deepEqual(store.updates[0], {
      id: memoryId,
      input: {
        scope: "app",
        app: "erp",
        category: "instruction",
        content: "Mora em São Paulo",
      },
    });

    const deleted = await handleMemories(
      jsonRequest("DELETE", `/functions/v1/memories/${memoryId}`),
      dependencies,
    );
    assert.equal(deleted.status, 200);
    const deletedBody = await deleted.json();
    assert.equal(deletedBody.ok, true);
    assert.deepEqual(deletedBody.data, { memory_id: memoryId, deleted: true });
    assert.equal(typeof deletedBody.request_id, "string");
  });
});

test("Memory API rejeita source, user_id, escopo incoerente e conteúdo excessivo", async () => {
  await withMockRuntime(async () => {
    const store = new FakeMemoryStore();
    const dependencies = {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    };
    const invalidBodies = [
      { scope: "global", category: "fact", content: "x", source: "system" },
      { scope: "global", category: "fact", content: "x", user_id: principal.userId },
      { scope: "app", app: null, category: "fact", content: "x" },
      { scope: "global", app: "nexa", category: "fact", content: "x" },
      { scope: "global", category: "fact", content: "x".repeat(2_001) },
    ];

    for (const body of invalidBodies) {
      const response = await handleMemories(jsonRequest("POST", "/memories", body), dependencies);
      assert.equal(response.status, 400);
    }
    assert.equal(store.creates.length, 0);
  });
});

test("Memory API exige Auth e esconde memória inexistente", async () => {
  await withMockRuntime(async () => {
    const unauthorized = await handleMemories(jsonRequest("GET", "/memories"));
    assert.equal(unauthorized.status, 401);

    const store = new FakeMemoryStore();
    store.memory = null;
    const missing = await handleMemories(jsonRequest("GET", `/memories/${memoryId}`), {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => store,
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "MEMORY_NOT_FOUND");
  });
});

test("Memory API interrompe corpo acima de 8 KiB antes do store", async () => {
  await withMockRuntime(async () => {
    let storeCalls = 0;
    const request = jsonRequest("POST", "/memories", {
      scope: "global",
      category: "fact",
      content: "x".repeat(9_000),
    });
    assert.equal(request.headers.get("content-length"), null);
    const response = await handleMemories(request, {
      authenticate: () => Promise.resolve(principal),
      storeFactory: () => {
        storeCalls += 1;
        throw new Error("store não deveria ser criado");
      },
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
    assert.equal(storeCalls, 0);
  });
});
