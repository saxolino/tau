import type { JSONSchema7 } from '@taucad/runtime/types';

/**
 * What a value assumption says beyond its reason (SinopiaCAD D2 §2.7): the recognition's confidence and source and the
 * plausible band seen in the photo. All optional: a plain `[sinopia:assumed] reason` is still an assumption.
 * @public
 */
export type AssumptionDetails = Readonly<{
  reason: string;
  /** 0–1. */
  confidence?: number;
  /** `proporzione`, `non_visibile`, `default_mestiere`… */
  source?: string;
  min?: number;
  max?: number;
}>;

/** The marker the kernel writes at the start of a field description. @public */
export const assumptionMarker = '[sinopia:assumed';

const attributeBlock = /^\[((?:\s*(?:c|f|min|max)=[^\s\]]+)+)\s*\]\s*/u;

const readAttributes = (block: string): Omit<AssumptionDetails, 'reason'> => {
  const details: { confidence?: number; source?: string; min?: number; max?: number } = {};
  for (const pair of block.trim().split(/\s+/u)) {
    const [key, raw = ''] = pair.split('=');
    const number = Number(raw);
    if (key === 'f' && /^[a-z_]{1,40}$/u.test(raw)) {
      details.source = raw;
    } else if (key === 'c' && Number.isFinite(number) && number >= 0 && number <= 1) {
      details.confidence = number;
    } else if (key === 'min' && Number.isFinite(number)) {
      details.min = number;
    } else if (key === 'max' && Number.isFinite(number)) {
      details.max = number;
    }
  }
  return details;
};

const attributeText = (details: Omit<AssumptionDetails, 'reason'>): string =>
  [
    details.confidence === undefined ? '' : `c=${Number(details.confidence.toFixed(2))}`,
    details.source === undefined || !/^[a-z_]{1,40}$/u.test(details.source) ? '' : `f=${details.source}`,
    details.min === undefined || !Number.isFinite(details.min) ? '' : `min=${Number(details.min.toFixed(3))}`,
    details.max === undefined || !Number.isFinite(details.max) ? '' : `max=${Number(details.max.toFixed(3))}`,
  ]
    .filter(Boolean)
    .join(' ');

/**
 * An `ipotesi` value with its details, as a recipe writes it: `[c=0.62 f=proporzione min=78 max=92] reason`, or the
 * bare reason when nothing else is known.
 * @param details - Reason, confidence, source and band.
 * @returns The string to put in the module's `ipotesi` map.
 * @public
 */
export function formatAssumption(details: AssumptionDetails): string {
  const attributes = attributeText(details);
  return attributes ? `[${attributes}] ${details.reason}` : details.reason;
}

const fromAuthored = (value: unknown): AssumptionDetails | undefined => {
  if (typeof value === 'string') {
    const block = attributeBlock.exec(value);
    return block ? { ...readAttributes(block[1]!), reason: value.slice(block[0].length) } : { reason: value };
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const authored = value as Record<string, unknown>;
    const reason = typeof authored['motivo'] === 'string' ? authored['motivo'] : authored['reason'];
    if (typeof reason !== 'string') {
      return undefined;
    }
    const number = (key: string): number | undefined =>
      typeof authored[key] === 'number' && Number.isFinite(authored[key]) ? authored[key] : undefined;
    const confidence = number('confidenza') ?? number('confidence');
    const source = authored['fonte'] ?? authored['source'];
    const min = number('min');
    const max = number('max');
    return {
      reason,
      ...(confidence === undefined || confidence < 0 || confidence > 1 ? {} : { confidence }),
      ...(typeof source === 'string' ? { source } : {}),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    };
  }
  return undefined;
};

/**
 * The schema description that carries an assumption to the hosts: `[sinopia:assumed] reason`, with the attributes
 * inside the marker when there are any (`[sinopia:assumed c=0.62 f=proporzione min=78 max=92] reason`).
 * @param details - The assumption.
 * @returns The description.
 * @public
 */
export function assumptionDescription(details: AssumptionDetails): string {
  const attributes = attributeText(details);
  return `${assumptionMarker}${attributes ? ` ${attributes}` : ''}] ${details.reason.slice(0, 2000)}`;
}

/**
 * Read an assumption back from a schema description. Backward compatible: `[sinopia:assumed] reason` gives the reason
 * alone; attributes that do not parse are ignored.
 * @param description - A field description.
 * @returns The assumption, or undefined when the description carries none.
 * @public
 */
export function parseAssumptionDescription(description: string | undefined): AssumptionDetails | undefined {
  if (!description?.startsWith(assumptionMarker)) {
    return undefined;
  }
  const rest = description.slice(assumptionMarker.length);
  const close = rest.indexOf(']');
  if (close === -1 || (close > 0 && !/^\s/u.test(rest))) {
    return undefined;
  }
  return { ...readAttributes(rest.slice(0, close)), reason: rest.slice(close + 1).trim() };
}

/**
 * Copy authored `ipotesi` into ordinary schema descriptions, so the admitted manifest transports them to hosts.
 * Keys are dotted parameter paths or RFC 6901 pointers; a list marks a value, a map also explains the assumption. A
 * reason may start with an attribute block (`[c=0.62 f=proporzione min=78 max=92] reason`) or be an object
 * (`{ motivo, confidenza, fonte, min, max }`): the attributes travel inside the marker.
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
  for (const [key, authored] of entries.slice(0, 1000)) {
    const details = fromAuthored(authored);
    if (details === undefined) {
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
      field.description = assumptionDescription(details);
    }
  }
  return result;
}
