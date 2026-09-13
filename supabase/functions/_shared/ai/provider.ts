import type { NexaApp } from "../types/chat.ts";

export interface AIProviderRequest {
  app: NexaApp;
  message: string;
  instructions: string;
  context?: Record<string, unknown>;
  requestId: string;
}

export interface AIProviderResponse {
  reply: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export type AIProviderFactory = () => AIProvider;
