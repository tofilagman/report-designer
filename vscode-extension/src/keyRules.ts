/** Same minimum the report server enforces for REPORT_SERVER_KEY. */
export const MIN_KEY_LENGTH = 32;

export function validateKey(value: string): string | undefined {
  const key = value.trim();
  if (!key) return 'Enter the key';
  if (/\s/.test(key)) return 'The key cannot contain spaces';
  if (key.length < MIN_KEY_LENGTH) return `The key must be at least ${MIN_KEY_LENGTH} characters (the server rejects shorter keys)`;
  return undefined;
}
