import type { NexaApp } from "../types/chat.ts";
import type { ProviderRoutingMetadata } from "../errors/provider-error.ts";

export interface AIProviderRequest {
  app: NexaApp;
  message: string;
  instructions: string;
  context?: Record<string, unknown>;
  requestId: string;
  history?: readonly AIHistoryMessage[];
}

export interface AIHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIProviderResponse {
  reply: string;
  provider?: string;
  model?: string;
  routing?: ProviderRoutingMetadata;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly configured?: boolean;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export type AIProviderFactory = () => AIProvider;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
