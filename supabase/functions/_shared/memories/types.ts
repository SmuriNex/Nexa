import type { NexaApp } from "../types/chat.ts";

export const MEMORY_SCOPES = ["global", "app"] as const;
export const MEMORY_CATEGORIES = ["preference", "fact", "instruction"] as const;
export const MEMORY_SOURCES = ["user_explicit", "app_context", "system"] as const;

export const MEMORY_CONTENT_MAX_CHARACTERS = 2_000;
// Chat receives a deterministic newest-first prefix. Older entries are dropped
// once either bound is reached; memory content never changes system instructions.
export const MEMORY_CONTEXT_MAX_ENTRIES = 12;
export const MEMORY_CONTEXT_MAX_CHARACTERS = 6_000;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  app: NexaApp | null;
  category: MemoryCategory;
  content: string;
  source: MemorySource;
  created_at: string;
  updated_at: string;
}

export interface MemoryContextEntry {
  scope: MemoryScope;
  app: NexaApp | null;
  category: MemoryCategory;
  content: string;
}

export interface CreateMemoryInput {
  scope: MemoryScope;
  app: NexaApp | null;
  category: MemoryCategory;
  content: string;
}

export type UpdateMemoryInput = CreateMemoryInput;

export interface MemoryContextStore {
  listForChat(app: NexaApp): Promise<MemoryContextEntry[]>;
}

export interface MemoryStore extends MemoryContextStore {
  getMemory(id: string): Promise<MemoryRecord | null>;
  listMemories(limit: number, offset: number): Promise<MemoryRecord[]>;
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord>;
  updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryRecord | null>;
  deleteMemory(id: string): Promise<boolean>;
}
