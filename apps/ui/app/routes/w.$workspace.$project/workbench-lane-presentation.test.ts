import { describe, expect, it } from 'vitest';
import type { WorkbenchLaneNode } from '@taucad/workbench';
import {
  misureWorkbenchNode,
  presentWorkbenchNode,
} from '#routes/w.$workspace.$project/workbench-lane-presentation.js';

const none = new Set<string>();

describe('presentWorkbenchNode', () => {
  it('keeps Misure and drops the main.ts tab a stored layout still names', () => {
    // The arrangement Tau saved for the necklace project: the code with its file tree, then Parameters.
    const stored: WorkbenchLaneNode = {
      kind: 'group',
      tabs: [
        { kind: 'file', path: 'main.ts', filesOpen: true },
        { kind: 'pane', pane: 'parameters' },
      ],
    };

    expect(presentWorkbenchNode(stored, none)).toEqual({ kind: 'group', tabs: [{ kind: 'pane', pane: 'parameters' }] });
  });

  it('never opens a file the agent arranged into the lane', () => {
    const arranged: WorkbenchLaneNode = {
      kind: 'group',
      tabs: [
        { kind: 'pane', pane: 'parameters' },
        { kind: 'file', path: 'main.ts' },
      ],
      active: 1,
    };

    const shown = presentWorkbenchNode(arranged, none);
    expect(shown).toEqual({ kind: 'group', tabs: [{ kind: 'pane', pane: 'parameters' }] });
    expect(shown).not.toHaveProperty('active');
  });

  it('keeps a file the person opened in this window, with its place and active tab', () => {
    const arranged: WorkbenchLaneNode = {
      kind: 'group',
      tabs: [
        { kind: 'pane', pane: 'parameters' },
        { kind: 'file', path: 'main.ts' },
      ],
      active: 1,
    };

    expect(presentWorkbenchNode(arranged, new Set(['main.ts']))).toBe(arranged);
  });

  it('collapses a split the dropped file leaves with one side, in the split’s place', () => {
    const split: WorkbenchLaneNode = {
      kind: 'split',
      direction: 'column',
      size: 2,
      children: [
        { kind: 'group', tabs: [{ kind: 'file', path: 'main.ts' }] },
        {
          kind: 'group',
          size: 1,
          tabs: [
            { kind: 'pane', pane: 'parameters' },
            { kind: 'pane', pane: 'export' },
          ],
        },
      ],
    };

    expect(presentWorkbenchNode(split, none)).toEqual({
      kind: 'group',
      size: 2,
      tabs: [
        { kind: 'pane', pane: 'parameters' },
        { kind: 'pane', pane: 'export' },
      ],
    });
  });

  it('keeps the active tab on the same tab when an earlier one is dropped', () => {
    const arranged: WorkbenchLaneNode = {
      kind: 'group',
      tabs: [
        { kind: 'file', path: 'main.ts' },
        { kind: 'pane', pane: 'parameters' },
        { kind: 'pane', pane: 'export' },
      ],
      active: 2,
    };

    expect(presentWorkbenchNode(arranged, none)).toEqual({
      kind: 'group',
      tabs: [
        { kind: 'pane', pane: 'parameters' },
        { kind: 'pane', pane: 'export' },
      ],
      active: 1,
    });
  });

  it('shows Misure in a lane left with nothing, and in an empty launcher', () => {
    expect(presentWorkbenchNode({ kind: 'group', tabs: [{ kind: 'file', path: 'main.ts' }] }, none)).toBe(
      misureWorkbenchNode,
    );
    expect(presentWorkbenchNode({ kind: 'group', tabs: [] }, none)).toBe(misureWorkbenchNode);
    expect(misureWorkbenchNode).toEqual({ kind: 'group', tabs: [{ kind: 'pane', pane: 'parameters' }] });
  });
});
