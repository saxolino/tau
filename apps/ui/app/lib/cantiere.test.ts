import { describe, expect, it } from 'vitest';
import type { MyMessagePart } from '@taucad/chat';
import {
  assistantText,
  cantiereSteps,
  idleMontaggio,
  montaggioGraceMilliseconds,
  nextMontaggio,
  readFootprint,
} from '#lib/cantiere.js';
import type { MontaggioMemory } from '#lib/cantiere.js';

const running = (toolName: string, input: Record<string, unknown> = {}): MyMessagePart => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: `${toolName}-running`,
  state: 'input-available',
  input,
});

const done = (toolName: string, input: Record<string, unknown> = {}): MyMessagePart => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: `${toolName}-done`,
  state: 'output-available',
  input,
  output: {},
});

const failed = (toolName: string): MyMessagePart => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: `${toolName}-failed`,
  state: 'output-error',
  input: {},
  errorText: 'build failed',
});

const text = (value: string): MyMessagePart => ({ type: 'text', text: value });

/** What a step shows: its words and its mark. */
const shown = (steps: ReturnType<typeof cantiereSteps>): Array<Pick<(typeof steps)[number], 'kind' | 'state'>> =>
  steps.map(({ kind, state }) => ({ kind, state }));

describe('cantiereSteps', () => {
  // ── From tool calls to steps ───────────────────────────────────────────────

  it('should turn each tool call into a step in the designer’s words, in order', () => {
    const steps = cantiereSteps({
      parts: [done('use_skill'), done('read_file'), done('create_file'), done('evaluate_model'), running('test_model')],
      isLive: true,
      imageAttached: false,
    });

    expect(shown(steps)).toEqual([
      { kind: 'study', state: 'done' },
      { kind: 'read', state: 'done' },
      { kind: 'write', state: 'done' },
      { kind: 'build', state: 'done' },
      { kind: 'check', state: 'active' },
    ]);
  });

  it('should fold calls of the same kind in a row into one step', () => {
    const steps = cantiereSteps({
      parts: [done('read_file'), done('list_directory'), done('grep'), running('read_file')],
      isLive: true,
      imageAttached: false,
    });

    expect(shown(steps)).toEqual([{ kind: 'read', state: 'active' }]);
  });

  it('should add a running thinking step while the agent is between two calls', () => {
    const steps = cantiereSteps({
      parts: [done('read_file'), text('Telaio 38 × 32 mm')],
      isLive: true,
      imageAttached: false,
    });

    expect(shown(steps)).toEqual([
      { kind: 'read', state: 'done' },
      { kind: 'think', state: 'active' },
    ]);
  });

  it('should start from the request, or from its image, before the first call', () => {
    expect(shown(cantiereSteps({ parts: undefined, isLive: true, imageAttached: false }))).toEqual([
      { kind: 'request', state: 'active' },
    ]);
    expect(shown(cantiereSteps({ parts: [], isLive: true, imageAttached: true }))).toEqual([
      { kind: 'image', state: 'active' },
    ]);
  });

  it('should keep a failed call as a failed step, not a ticked one', () => {
    const steps = cantiereSteps({ parts: [failed('evaluate_model')], isLive: false, imageAttached: false });

    expect(shown(steps)).toEqual([{ kind: 'build', state: 'failed' }]);
  });

  it('should name an image read, a native tool behind the MCP bridge and an unknown tool', () => {
    const bridged: MyMessagePart = {
      ...done('mcp__tau__screenshot'),
      toolMetadata: { tau: { presentation: 'tau-mcp', nativeName: 'screenshot' } },
    };
    const steps = cantiereSteps({
      parts: [done('read_file', { targetFile: 'foto/fibbia.jpg' }), bridged, done('mystery_tool')],
      isLive: false,
      imageAttached: false,
    });

    expect(steps.map((step) => step.kind)).toEqual(['image', 'views', 'work']);
  });

  it('should key each step by its first call, so a growing step keeps its place', () => {
    const steps = cantiereSteps({
      parts: [done('read_file'), running('list_directory')],
      isLive: true,
      imageAttached: false,
    });

    expect(steps).toEqual([{ id: 'read_file-done', kind: 'read', state: 'active' }]);
  });

  it('should add no running step once the turn has ended', () => {
    expect(shown(cantiereSteps({ parts: [done('create_file')], isLive: false, imageAttached: false }))).toEqual([
      { kind: 'write', state: 'done' },
    ]);
  });
});

describe('readFootprint', () => {
  it.each([
    ['Telaio 38 × 32 mm, traversa e ardiglione.', { width: 38, height: 32 }],
    ['ingombro 38x32mm', { width: 38, height: 32 }],
    ['telaio 38 X 32', { width: 38, height: 32 }],
    ['Fibbia con telaio di 38,5 × 32 mm', { width: 38.5, height: 32 }],
    ['frame 38.5 x 32.25 mm', { width: 38.5, height: 32.25 }],
    ['Telaio 38 mm × 32 mm', { width: 38, height: 32 }],
    ['placca 3,8 × 3,2 cm', { width: 38, height: 32 }],
    ['telaio 38 × 32 × 3,5 mm', { width: 38, height: 32 }],
  ])('should read %j', (input, expected) => {
    expect(readFootprint(input)).toEqual(expected);
  });

  it('should find no footprint in a text without a pair of sizes', () => {
    expect(readFootprint('Una fibbia 30 mm per cinturino.')).toBeUndefined();
    expect(readFootprint('')).toBeUndefined();
  });

  it('should ignore a thread size, a screen resolution and sizes beyond a metre', () => {
    expect(readFootprint('vite M3x0,5 e uno schermo 1920x1080, tavolo 1200 × 800 mm')).toBeUndefined();
  });

  it('should prefer the size announced as the overall one', () => {
    expect(readFootprint('Luce interna 30 × 40 mm; telaio esterno: 38 × 32 mm.')).toEqual({ width: 38, height: 32 });
  });

  it('should prefer a size with a unit, then the largest', () => {
    expect(readFootprint('rapporto 3x4, poi 38 × 32 mm')).toEqual({ width: 38, height: 32 });
    expect(readFootprint('passante 30 × 4 mm e anello 40 × 35 mm')).toEqual({ width: 40, height: 35 });
  });

  it('should read the text the agent has written across its parts', () => {
    expect(
      readFootprint(assistantText([text('Imposto la fibbia:'), done('read_file'), text('telaio 38 × 32 mm')])),
    ).toEqual({
      width: 38,
      height: 32,
    });
  });
});

describe('nextMontaggio', () => {
  const facts = { turnKey: 'turn-1', isLive: true, isModelEmpty: true, playedKey: undefined, now: 1000 } as const;

  it('should arm the turn that runs on an empty model', () => {
    expect(nextMontaggio(idleMontaggio, facts).armedKey).toBe('turn-1');
  });

  it('should stay armed when the first geometry arrives in that turn', () => {
    const armed = nextMontaggio(idleMontaggio, facts);

    expect(nextMontaggio(armed, { ...facts, isModelEmpty: false }).armedKey).toBe('turn-1');
  });

  it('should let go once the viewer has played the turn, so later changes draw at once', () => {
    const armed = nextMontaggio(idleMontaggio, facts);

    const played = nextMontaggio(armed, { ...facts, isModelEmpty: false, playedKey: 'turn-1' });

    expect(played).toEqual(idleMontaggio);
    expect(nextMontaggio(played, { ...facts, isModelEmpty: true, playedKey: 'turn-1' })).toEqual(idleMontaggio);
  });

  it('should never arm when a project opens with no turn running', () => {
    expect(nextMontaggio(idleMontaggio, { ...facts, isLive: false })).toEqual(idleMontaggio);
    expect(nextMontaggio(idleMontaggio, { ...facts, isLive: false, isModelEmpty: false })).toEqual(idleMontaggio);
  });

  it('should never arm a turn that changes a model with pieces', () => {
    expect(nextMontaggio(idleMontaggio, { ...facts, isModelEmpty: false })).toEqual(idleMontaggio);
  });

  it('should never arm a project reopened mid-turn while its model is still loading', () => {
    const memory: MontaggioMemory = idleMontaggio;

    expect(nextMontaggio(memory, { ...facts, isModelEmpty: false, turnKey: 'turn-7' })).toEqual(idleMontaggio);
  });

  it('should let go of an armed turn when the next turn starts on a model with pieces', () => {
    const armed = nextMontaggio(idleMontaggio, facts);

    expect(nextMontaggio(armed, { ...facts, turnKey: 'turn-2', isModelEmpty: false })).toEqual(idleMontaggio);
  });

  it('should keep a finished turn armed for a late build, then let go', () => {
    const armed = nextMontaggio(idleMontaggio, facts);
    const ended = nextMontaggio(armed, { ...facts, isLive: false, now: 2000 });

    expect(ended.armedKey).toBe('turn-1');
    expect(nextMontaggio(ended, { ...facts, isLive: false, now: 2000 + montaggioGraceMilliseconds }).armedKey).toBe(
      'turn-1',
    );
    expect(nextMontaggio(ended, { ...facts, isLive: false, now: 2001 + montaggioGraceMilliseconds })).toEqual(
      idleMontaggio,
    );
  });
});
