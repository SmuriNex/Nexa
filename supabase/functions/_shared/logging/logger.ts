export interface RequestLog {
  request_id: string;
  app?: string;
  provider?: string;
  duration_ms: number;
  success: boolean;
  error_code?: string;
}

export type RequestLogger = (entry: RequestLog) => void;

export const logRequest: RequestLogger = (entry) => {
  console.log(JSON.stringify({ event: "nexa_request", ...entry }));
};
