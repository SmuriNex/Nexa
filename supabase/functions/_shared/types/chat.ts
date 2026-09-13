export const SUPPORTED_APPS = ["nexa", "ascent", "erp"] as const;

export type NexaApp = (typeof SUPPORTED_APPS)[number];

export interface ChatRequest {
  app: NexaApp;
  message: string;
  conversation_id?: string;
  context?: Record<string, unknown>;
}

export interface ChatData {
  reply: string;
  app: NexaApp;
  provider: string;
  model: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  request_id: string;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  request_id: string;
}
