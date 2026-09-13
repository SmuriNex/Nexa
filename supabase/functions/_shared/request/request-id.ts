const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function resolveRequestId(candidate?: string | null): string {
  const value = candidate?.trim();
  return value && REQUEST_ID_PATTERN.test(value) ? value : crypto.randomUUID();
}
