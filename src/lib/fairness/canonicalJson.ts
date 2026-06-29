export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function normalize(value: unknown): CanonicalJsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalize(item) ?? null);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value as string | boolean;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot canonicalize non-finite number: ${value}`);
    }
    return value;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      const normalized = normalize(input[key]);
      if (typeof normalized !== 'undefined') {
        output[key] = normalized;
      }
    }
    return output;
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  const normalized = normalize(value);
  if (typeof normalized === 'undefined') {
    throw new Error('Cannot canonicalize undefined as the root value');
  }
  return JSON.stringify(normalized);
}
