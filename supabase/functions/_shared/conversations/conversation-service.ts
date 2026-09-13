import type { AIHistoryMessage } from "../ai/provider.ts";
import type { NexaCore } from "../core/nexa-core.ts";
import { NexaError } from "../errors/nexa-error.ts";
import type { ChatData, NexaApp } from "../types/chat.ts";
import { validateChatRequest } from "../validation/chat-request.ts";
import type { MemoryContextStore } from "../memories/types.ts";

export const HISTORY_MAX_MESSAGES = 8;
export const HISTORY_MAX_CHARACTERS = 12_000;

export interface ConversationRecord {
  id: string;
  app: NexaApp;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord extends AIHistoryMessage {
  id: string;
  conversation_id: string;
  provider: string | null;
  model: string | null;
  request_id: string | null;
  created_at: string;
}

export interface CommitTurnInput {
  conversationId: string;
  createNew: boolean;
  app: NexaApp;
  userContent: string;
  assistantContent: string;
  provider: string;
  model: string;
  requestId: string;
}

export interface ConversationStore {
  getConversation(id: string): Promise<ConversationRecord | null>;
  getRecentMessages(id: string, limit: number): Promise<AIHistoryMessage[]>;
  consumeRateLimit(maxRequests: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  commitTurn(input: CommitTurnInput): Promise<void>;
  listConversations(limit: number, offset: number): Promise<ConversationRecord[]>;
  listMessages(id: string, limit: number, offset: number): Promise<MessageRecord[]>;
  deleteConversation(id: string): Promise<boolean>;
}

function boundedHistory(messages: readonly AIHistoryMessage[]): AIHistoryMessage[] {
  const bounded = messages.slice(-HISTORY_MAX_MESSAGES).filter((item) =>
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" && item.content.length > 0
  );
  let characters = bounded.reduce((total, item) => total + item.content.length, 0);
  while (characters > HISTORY_MAX_CHARACTERS && bounded.length > 0) {
    characters -= bounded.shift()!.content.length;
  }
  return bounded;
}

export class ConversationService {
  private readonly store: ConversationStore;
  private readonly core: NexaCore;
  private readonly rateLimitPerMinute: number;
  private readonly memoryStore?: MemoryContextStore;

  constructor(
    store: ConversationStore,
    core: NexaCore,
    rateLimitPerMinute: number,
    memoryStore?: MemoryContextStore,
  ) {
    this.store = store;
    this.core = core;
    this.rateLimitPerMinute = rateLimitPerMinute;
    this.memoryStore = memoryStore;
  }

  async chat(payload: unknown, requestId: string): Promise<ChatData & { conversation_id: string }> {
    const request = validateChatRequest(payload);
    const createNew = request.conversation_id === undefined;
    const conversationId = request.conversation_id ?? crypto.randomUUID();

    if (!createNew) {
      const conversation = await this.store.getConversation(conversationId);
      if (!conversation) {
        throw new NexaError("CONVERSATION_NOT_FOUND", "Conversa não encontrada.", 404);
      }
      if (conversation.app !== request.app) {
        throw new NexaError(
          "CONVERSATION_APP_MISMATCH",
          "O aplicativo da conversa não corresponde à solicitação.",
          409,
        );
      }
    }

    const quota = await this.store.consumeRateLimit(this.rateLimitPerMinute);
    if (!quota.allowed) {
      throw new NexaError(
        "RATE_LIMITED",
        "Limite de mensagens atingido. Tente novamente em instantes.",
        429,
        Math.max(1, quota.retryAfterSeconds),
      );
    }

    const [history, memories] = await Promise.all([
      createNew
        ? Promise.resolve([])
        : this.store.getRecentMessages(conversationId, HISTORY_MAX_MESSAGES).then(boundedHistory),
      this.memoryStore?.listForChat(request.app) ?? Promise.resolve([]),
    ]);

    const result = await this.core.chat(request, requestId, history, conversationId, memories);

    await this.store.commitTurn({
      conversationId,
      createNew,
      app: request.app,
      userContent: request.message,
      assistantContent: result.reply,
      provider: result.provider,
      model: result.model,
      requestId: result.requestId,
    });

    return {
      conversation_id: conversationId,
      reply: result.reply,
      app: result.app,
      provider: result.provider,
      model: result.model,
    };
  }
}
