/**
 * Guards — the checkpoint between untyped JSON and a domain object.
 *
 * The repository layer is the seam that keeps provider types out of the app.
 * A seam made only of TypeScript interfaces is a promise, not a boundary: the
 * compiler is happy to believe a cast about data it has never seen. These
 * functions check at runtime, and throw with the field name when the shape is
 * not what was agreed.
 */

export class MalformedRowError extends Error {
  constructor(field: string, detail: string) {
    super(`Malformed data from the database: ${field} ${detail}.`);
    this.name = 'MalformedRowError';
  }
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedRowError(field, 'is not an object');
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MalformedRowError(field, `is ${typeof value}, not a string`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, field);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MalformedRowError(field, `is ${typeof value}, not a boolean`);
  }
  return value;
}

export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const text = requireString(value, field);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new MalformedRowError(field, `is ${JSON.stringify(text)}, which is not one of the values we know`);
  }
  return text as T;
}

/**
 * A Postgres bigint arrives over JSON as a plain number, which is exact only
 * below 2^53. Household figures live far below that, but "far below" is not a
 * guarantee, and a silently truncated paise is the one bug this codebase is
 * least willing to ship. So: exact, or an error.
 *
 * A string is accepted too, since that is what a driver configured to preserve
 * bigint precision would hand over.
 */
export function toBigIntExact(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new MalformedRowError(field, `is ${String(value)}, which is not a whole number of minor units`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new MalformedRowError(
        field,
        `is ${String(value)}, which is too large to have survived JSON intact`,
      );
    }
    return BigInt(value);
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new MalformedRowError(field, `is ${typeof value}, not an integer`);
}
