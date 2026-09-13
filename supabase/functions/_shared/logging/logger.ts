export interface RequestLog {
  stage: "provider" | "request";
  request_id: string;
  app?: string;
  conversation_id?: string;
  primary_provider?: string;
  provider?: string;
  fallback_used?: boolean;
  fallback_reason?: string;
  duration_ms: number;
  success: boolean;
  error_code?: string;
}

export type RequestLogger = (entry: RequestLog) => void;

export const logRequest: RequestLogger = (entry) => {
  console.log(JSON.stringify({ event: "nexa_request", ...entry }));
};
