export class NexaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "NexaError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function asNexaError(error: unknown): NexaError {
  if (error instanceof NexaError) {
    return error;
  }

  return new NexaError(
    "INTERNAL_ERROR",
    "Não foi possível processar a solicitação.",
    500,
  );
}
