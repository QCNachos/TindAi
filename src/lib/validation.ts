// Shared validation utilities -- single source of truth for format checks

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** Max message content length in characters */
export const MAX_MESSAGE_LENGTH = 2000;

/** Max bio length in characters */
export const MAX_BIO_LENGTH = 500;
