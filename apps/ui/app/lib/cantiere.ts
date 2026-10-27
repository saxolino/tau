import type { MyMessagePart } from '@taucad/chat';
import { isRecord } from '@taucad/utils/schema';
import { agentApprovalToolName } from '#services/agent-host-event-projection.js';
import { isActivityPartActive } from '#utils/assistant-message-activity.js';

/**
 * The viewer while the agent builds a model from nothing: «Cantiere» names its steps and draws the size it has
 * announced, «Montaggio» brings the new pieces in one at a time. Both read only what the turn already carries — the
 * tool calls and the text the agent has written — so they add no model call, no prompt and no wait.
 */

/** A step of the agent, in the designer's words: `cantiere.steps.<kind>`. */
export type CantiereStepKind =
  | 'request'
  | 'image'
  | 'study'
  | 'read'
  | 'plan'
  | 'write'
  | 'build'
  | 'check'
  | 'views'
  | 'web'
  | 'question'
  | 'think'
  | 'work';

/** One step: done (ticked), failed (the agent goes on), or running (it pulses); `id` is its first call's. */
export type CantiereStep = Readonly<{ id: string; kind: CantiereStepKind; state: 'done' | 'failed' | 'active' }>;

/** Tool names as the agent's tools register them (snake case), by step. */
const stepKinds: ReadonlyMap<string, CantiereStepKind> = new Map<string, CantiereStepKind>([
  ['use_skill', 'study'],
  ['resolve_skill', 'study'],
  ['install_packages', 'study'],
  ['read_file', 'read'],
  ['list_directory', 'read'],
  ['get_parameters', 'read'],
  ['grep', 'read'],
  ['glob_search', 'read'],
  ['revisions', 'read'],
  ['read_revisions', 'read'],
  ['update_todos', 'plan'],
  ['write_todos', 'plan'],
  ['create_file', 'write'],
  ['edit_file', 'write'],
  ['append_file', 'write'],
  ['delete_file', 'write'],
  ['apply_parameter_operation', 'write'],
  ['evaluate_model', 'build'],
  ['get_kernel_result', 'build'],
  ['test_model', 'check'],
  ['run_geospec_tests', 'check'],
  ['screenshot', 'views'],
  ['capture_images', 'views'],
  ['web_search', 'web'],
  ['web_browser', 'web'],
  ['ask_questions', 'question'],
  ['AskUserQuestion', 'question'],
  ['request_user_input', 'question'],
]);

/** Names an unlisted tool by its words, as the composer's activity line does. */
const guessedKinds: ReadonlyArray<readonly [RegExp, CantiereStepKind]> = [
  [/screenshot|capture/i, 'views'],
  [/test|check|verif/i, 'check'],
  [/evaluat|render|build/i, 'build'],
  [/edit|write|create|append|parameter|delete/i, 'write'],
  [/read|list|grep|search|glob|find/i, 'read'],
];

const imageFile = /\.(?:png|jpe?g|webp|gif|avif)$/i;

/** The tool a part calls: its native name behind Tau's MCP bridge, its own name otherwise. */
const toolNameOf = (part: MyMessagePart): string | undefined => {
  if (part.type === 'dynamic-tool') {
    const tau = isRecord(part.toolMetadata?.['tau']) ? part.toolMetadata['tau'] : undefined;
    const nativeName = tau?.['nativeName'];
    return typeof nativeName === 'string' ? nativeName : part.toolName;
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined;
};

const stepKindOf = (part: MyMessagePart): CantiereStepKind | undefined => {
  const name = toolNameOf(part);
  if (name === undefined || name === agentApprovalToolName) {
    return undefined;
  }
  const kind = stepKinds.get(name) ?? guessedKinds.find(([pattern]) => pattern.test(name))?.[1] ?? 'work';
  if (kind === 'read') {
    const input: unknown = Reflect.get(part, 'input');
    const target = isRecord(input) ? (input['targetFile'] ?? input['path']) : undefined;
    if (typeof target === 'string' && imageFile.test(target)) {
      return 'image';
    }
  }
  return kind;
};

const stepState = (part: MyMessagePart): CantiereStep['state'] => {
  if (isActivityPartActive(part)) {
    return 'active';
  }
  const state: unknown = Reflect.get(part, 'state');
  return state === 'output-error' || state === 'output-denied' ? 'failed' : 'done';
};

/**
 * The agent's steps so far, from the tool calls of the turn: calls of the same kind in a row are one step. While the
 * turn runs, the last step is running: the call in progress, or the agent thinking between two calls.
 *
 * @param input - The turn's latest assistant parts, whether the turn is running and whether the request has an image.
 * @returns The steps in order, the last one running while the turn runs.
 */
export function cantiereSteps({
  parts,
  isLive,
  imageAttached,
}: Readonly<{
  parts: readonly MyMessagePart[] | undefined;
  isLive: boolean;
  imageAttached: boolean;
}>): CantiereStep[] {
  const steps: CantiereStep[] = [];
  for (const part of parts ?? []) {
    const kind = stepKindOf(part);
    if (kind === undefined) {
      continue;
    }
    const previous = steps.at(-1);
    if (previous?.kind === kind) {
      steps[steps.length - 1] = { ...previous, state: stepState(part) };
    } else {
      const callId: unknown = Reflect.get(part, 'toolCallId');
      steps.push({ id: typeof callId === 'string' ? callId : `step-${steps.length}`, kind, state: stepState(part) });
    }
  }
  if (!isLive) {
    return steps;
  }
  if (steps.length === 0) {
    return [{ id: 'request', kind: imageAttached ? 'image' : 'request', state: 'active' }];
  }
  return steps.at(-1)?.state === 'active' ? steps : [...steps, { id: 'think', kind: 'think', state: 'active' }];
}

/** A size announced in the agent's text, in millimetres. */
export type Footprint = Readonly<{ width: number; height: number }>;

const decimal = String.raw`(\d{1,4}(?:[.,]\d{1,3})?)`;
const unit = String.raw`(?:\s*(mm|cm)\b)?`;
const times = String.raw`\s*[×xX✕*]\s*`;
/** Two or three sizes joined by «×» or «x», each with an optional unit, not glued to a word («M3x0,5»). */
const sizePattern = new RegExp(
  String.raw`(?<![\p{L}\d.,])${decimal}${unit}${times}${decimal}${unit}(?:${times}${decimal}${unit})?(?![\p{L}\d])`,
  'gu',
);
/** Words that announce an overall size just before it. */
const sizeWords =
  /(ingombr|estern|telaio|cornice|dimension|misur|totale|complessiv|piastra|placca|footprint|overall|outer|outside|frame|size)\S*\s*[:=]?\s*(?:di\s+|da\s+|of\s+)?$/iu;

const millimetres = (value: string, factor: number): number => Number(value.replace(',', '.')) * factor;

/**
 * The overall size the agent announced in its text, such as «telaio 38 × 32 mm». Accepts «×», «x» and «*», a decimal
 * comma or point, millimetres or centimetres; a size after words like «ingombro» or «telaio» wins, then one with a
 * unit, then the largest. A text without such a pair has no footprint.
 *
 * @param text - What the agent has written in this turn.
 * @returns Width and height in millimetres, or undefined when the text announces no size.
 */
export function readFootprint(text: string): Footprint | undefined {
  let best: { score: number; area: number; footprint: Footprint } | undefined;
  for (const match of text.matchAll(sizePattern)) {
    const [, first, firstUnit, second, secondUnit, , thirdUnit] = match;
    if (first === undefined || second === undefined) {
      continue;
    }
    const units = [thirdUnit, secondUnit, firstUnit].filter((value) => value !== undefined);
    const factor = units[0]?.toLowerCase() === 'cm' ? 10 : 1;
    const width = millimetres(first, factor);
    const height = millimetres(second, factor);
    if (!(width > 0 && height > 0 && width <= 1000 && height <= 1000)) {
      continue;
    }
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    const score = (sizeWords.test(before) ? 2 : 0) + (units.length > 0 ? 1 : 0);
    const area = width * height;
    if (!best || score > best.score || (score === best.score && area > best.area)) {
      best = { score, area, footprint: { width, height } };
    }
  }
  return best?.footprint;
}

/** The text parts of an assistant message, joined. */
export const assistantText = (parts: readonly MyMessagePart[] | undefined): string =>
  (parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

/** What the montage rule remembers between two looks at the turn. */
export type MontaggioMemory = Readonly<{
  /** The turn that found the model empty, armed for its first model. */
  armedKey: string | undefined;
  /** When that turn stopped running; it stays armed a little longer for a late build. Milliseconds since epoch. */
  quietSince: number | undefined;
}>;

/** Nothing armed. */
export const idleMontaggio: MontaggioMemory = { armedKey: undefined, quietSince: undefined };

/** How long a finished turn stays armed for a build that lands after it. Milliseconds. */
export const montaggioGraceMilliseconds = 15_000;

/**
 * The montage rule: the pieces of a model enter one at a time only for the first model the assistant produces in a
 * turn that started from an empty model. Opening a project, a later change or a later turn draws the model at once.
 *
 * @param memory - What the rule remembered last time.
 * @param facts - The turn (the request's message id), whether it runs, whether the model is known to have no piece,
 *   the key the viewer has already played and the current time in milliseconds since epoch.
 * @returns What to remember; its `armedKey` is the turn to arm the viewer for, if any.
 */
export function nextMontaggio(
  memory: MontaggioMemory,
  facts: Readonly<{
    turnKey: string | undefined;
    isLive: boolean;
    isModelEmpty: boolean;
    playedKey: string | undefined;
    now: number;
  }>,
): MontaggioMemory {
  const { turnKey, isLive, isModelEmpty, playedKey, now } = facts;
  if (turnKey === undefined || playedKey === turnKey) {
    return idleMontaggio;
  }
  const armedKey = isLive && isModelEmpty ? turnKey : memory.armedKey;
  if (armedKey !== turnKey) {
    return idleMontaggio;
  }
  if (isLive) {
    return { armedKey, quietSince: undefined };
  }
  const quietSince = memory.quietSince ?? now;
  return now - quietSince > montaggioGraceMilliseconds ? idleMontaggio : { armedKey, quietSince };
}
