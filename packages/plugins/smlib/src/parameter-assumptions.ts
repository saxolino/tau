import type { JSONSchema7 } from '@taucad/runtime/types';

/**
 * Copy authored `ipotesi` into ordinary schema descriptions, so the admitted manifest transports them to hosts.
 * Keys are dotted parameter paths or RFC 6901 pointers; a list marks a value, a map also explains the assumption.
 * @param schema - Inferred defaults schema.
 * @param module - Evaluated authoring module containing an optional `ipotesi` export.
 * @returns The annotated copy, or the input when no annotation was exported.
 */
export function annotateParameterAssumptions(schema: JSONSchema7, module: unknown): JSONSchema7 {
  if (typeof module !== 'object' || module === null || !('ipotesi' in module)) {
    return schema;
  }
  const assumptions: unknown = module.ipotesi;
  const entries = Array.isArray(assumptions)
    ? assumptions.filter((key): key is string => typeof key === 'string').map((key) => [key, ''] as const)
    : typeof assumptions === 'object' && assumptions !== null
      ? Object.entries(assumptions)
      : [];
  const result = structuredClone(schema);
  for (const [key, reason] of entries.slice(0, 1000)) {
    if (typeof reason !== 'string') {
      continue;
    }
    const path = key.startsWith('/')
      ? key
          .slice(1)
          .split('/')
          .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
      : key.split('.');
    let field: JSONSchema7 | undefined = result;
    for (const segment of path) {
      const next: JSONSchema7 | boolean | undefined = field?.properties?.[segment];
      field = typeof next === 'object' ? next : undefined;
    }
    if (field && field.type !== 'object' && field.type !== 'array') {
      field.description = `[sinopia:assumed] ${reason.slice(0, 2000)}`;
    }
  }
  return result;
}
