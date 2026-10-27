import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ActorRefFrom } from 'xstate';
import type { FileParameterEntry } from '@taucad/types';
import type { cadMachine } from '#machines/cad.machine.js';
import { ChatParameters, useProjectParametersSource } from '#routes/w.$workspace.$project/chat-parameters.js';

const availability = vi.hoisted(() => ({ current: 'ready' as 'ready' | 'downloading' }));
vi.mock('#hooks/use-project-availability.js', () => ({ useProjectAvailability: () => availability.current }));
/* The pane's own behaviour is proved in `piece-measures-pane.test.tsx`; here it only receives the project's source. */
const paneSource = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('#routes/w.$workspace.$project/piece-measures-pane.js', () => ({
  PieceMeasuresPane: ({ source }: { source: unknown }) => {
    paneSource.current = source;
    return <div data-testid='piece-measures-pane' />;
  },
}));
vi.mock('#routes/w.$workspace.$project/project-sync-placeholder.js', () => ({
  ProjectSyncPlaceholder: ({ state }: { state: string }) => <div data-testid='sync-placeholder'>{state}</div>,
}));

vi.mock('@xstate/react', () => ({
  useSelector: (actor: { getSnapshot: () => unknown } | undefined, selector: (state: unknown) => unknown) => {
    if (!actor) {
      return selector(undefined);
    }
    return selector(actor.getSnapshot());
  },
}));

const noop = (): void => {
  /* No-op */
};

const mockCadRef = {
  getSnapshot: vi.fn(() => ({
    context: {
      units: { length: 'mm' },
      activeKernelId: 'test',
      capabilities: { renderCapabilities: { test: { cancellation: 'cooperative' } } },
      parameterManifest: {
        revision: 'manifest',
        identity: { resolution: {} },
        defaults: { width: 10, height: 20 },
        legacyProjection: {
          status: 'usable',
          schema: {
            type: 'object',
            properties: {
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
      },
    },
    hasTag: () => false,
    matches: () => false,
  })),
  subscribe: () => ({ unsubscribe: noop }),
  send: vi.fn(),
} as unknown as ActorRefFrom<typeof cadMachine>;

const mockCadRef2 = {
  subscribe: () => ({ unsubscribe: noop }),
  getSnapshot: vi.fn(() => ({
    matches: () => false,
    context: {
      units: { length: 'm' },
      parameterManifest: {
        revision: 'manifest-2',
        identity: { resolution: {} },
        defaults: { radius: 5 },
        legacyProjection: {
          status: 'usable',
          schema: {
            type: 'object',
            properties: {
              radius: { type: 'number' },
            },
          },
        },
      },
    },
  })),
} as unknown as ActorRefFrom<typeof cadMachine>;

/** A unit whose kernel declares no cancellation, moved through render states by the test. */
function createUncancellableCadRef() {
  const listeners = new Set<(snapshot: unknown) => void>();
  const viewListeners = new Set<(status: 'rendering' | 'ready') => void>();
  let openAttempt = 0;
  const defaultView = {
    on: (_event: 'status', listener: (status: 'rendering' | 'ready') => void) => {
      viewListeners.add(listener);
      listener('ready');
      return () => viewListeners.delete(listener);
    },
  };
  const snapshotOf = (state: 'idle' | 'rendering') => ({
    context: {
      ...mockCadRef.getSnapshot().context,
      activeKernelId: 'openscad',
      capabilities: { renderCapabilities: { openscad: {} } },
      defaultView,
      openAttempt,
    },
    hasTag: () => false,
    matches: (value: string) => value === state,
  });
  let snapshot = snapshotOf('idle');
  const ref = {
    getSnapshot: () => snapshot,
    subscribe: (listener: (next: unknown) => void) => {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    send: vi.fn(),
  } as unknown as ActorRefFrom<typeof cadMachine>;
  const enter = (state: 'idle' | 'rendering'): void => {
    snapshot = snapshotOf(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
    for (const listener of viewListeners) {
      listener(state === 'idle' ? 'ready' : 'rendering');
    }
  };
  const repeatRendering = (): void => {
    for (const listener of viewListeners) {
      listener('rendering');
    }
  };
  const supersede = (): void => {
    openAttempt += 1;
    enter('rendering');
  };
  return { ref, enter, repeatRendering, supersede };
}

let mockGeometryUnits = new Map<string, ActorRefFrom<typeof cadMachine>>();
const mockMainEntryPath = 'main.ts';
const mockSetParameters = vi.fn();
const mockSetGeometryUnitParameters = vi.fn();
const mockSwitchParameterGroup = vi.fn();
const mockProjectSend = vi.fn();
const mockEditorSend = vi.fn();
let mockParameterEntries = new Map<string, FileParameterEntry>();
const mockResolveParameterEntry = vi.fn();
const mockEmptyParameterEntries = new Map<string, FileParameterEntry>();
const mockParameterSnapshots = new Map<
  string,
  Readonly<{
    entry: FileParameterEntry;
    identity: Readonly<{
      manifestRevision: string;
    }>;
  }>
>();
const mockParameterActors = new Map<
  string,
  { getSnapshot: () => unknown; subscribe: () => { unsubscribe: () => void }; send: ReturnType<typeof vi.fn> }
>();
let mockParameterState: 'ready' | 'disconnected' | 'uncertain' = 'ready';
const mockParameterActorSend = vi.fn();
const mockParameterService = {
  snapshot: (entryPath: string) => {
    let entry = mockParameterEntries.get(entryPath) ?? mockEmptyParameterEntries.get(entryPath);
    if (entry === undefined) {
      entry = {
        activeGroup: 'default',
        groups: { default: { values: {} } },
      };
      mockEmptyParameterEntries.set(entryPath, entry);
    }
    const current = mockParameterSnapshots.get(entryPath);
    if (current?.entry === entry) {
      return current;
    }
    const snapshot = {
      entry,
      manifest: { revision: 'manifest' },
      identity: {
        manifestRevision: 'manifest',
      },
    };
    mockParameterSnapshots.set(entryPath, snapshot);
    return snapshot;
  },
  // Readers select from the authority actor; this fake replays the stored snapshot to them.
  // One actor per entry, like the service: consumers rely on that identity being stable.
  actor: (entryPath: string) => {
    let actor = mockParameterActors.get(entryPath);
    if (actor === undefined) {
      actor = {
        getSnapshot: () => ({
          context: {
            current: mockParameterService.snapshot(entryPath),
            diagnostic: { code: 'WRITE_UNCERTAIN', message: 'The last write could not be confirmed.' },
          },
          matches: (value: { open?: string }) => value.open === mockParameterState,
        }),
        subscribe: () => ({ unsubscribe: () => undefined }),
        send: mockParameterActorSend,
      };
      mockParameterActors.set(entryPath, actor);
    }
    return actor;
  },
  target: (entry: string) => ({ authority: 'browser-filesystem', root: '/test', entry }),
};

/** The main view's graphics, whose display units every section shares. */
const mockMainGraphics = {
  getSnapshot: vi.fn(() => ({
    context: { displayUnits: { length: { symbol: 'mm', metersPerUnit: 0.001, system: 'si' } } },
  })),
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  on: vi.fn(() => ({ unsubscribe: vi.fn() })),
};

vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({
    projectRef: {
      getSnapshot: vi.fn(() => ({ context: { project: null } })),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      on: vi.fn(() => ({ unsubscribe: vi.fn() })),
      send: mockProjectSend,
    },
    // The model summary row counts the pieces of the model-interaction units; a model with none counts none.
    modelInteractionRef: {
      getSnapshot: vi.fn(() => ({ context: { unitOrder: [], unitsById: {} } })),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      on: vi.fn(() => ({ unsubscribe: vi.fn() })),
      send: vi.fn(),
    },
    editorRef: {
      getSnapshot: vi.fn(() => ({ context: {} })),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      on: vi.fn(() => ({ unsubscribe: vi.fn() })),
      send: mockEditorSend,
    },
    geometryUnits: mockGeometryUnits,
    mainEntryPath: mockMainEntryPath,
    viewGraphics: new Map([['view-1', mockMainGraphics]]),
    viewEntryPaths: new Map([['view-1', mockMainEntryPath]]),
    viewRecords: {},
    setParameters: mockSetParameters,
    setGeometryUnitParameters: mockSetGeometryUnitParameters,
    switchParameterGroup: mockSwitchParameterGroup,
    createParameterGroup: vi.fn(),
    deleteParameterGroup: vi.fn(),
    renameParameterGroup: vi.fn(),
    parameterService: mockParameterService,
    resolveParameterEntry: mockResolveParameterEntry,
  }),
  useParameterSetActor: (entryPath: string) => mockParameterService.actor(entryPath),
}));

vi.mock('@taucad/ui/components/keyboard', () => ({
  useKeybinding: () => ({ formattedKeyCombination: 'Ctrl+X' }),
}));

vi.mock('#components/ui/floating-panel.js', () => ({
  FloatingPanel: ({ children }: { children: React.ReactNode }) => <div data-testid='floating-panel'>{children}</div>,
  FloatingPanelContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FloatingPanelContentBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='panel-body'>{children}</div>
  ),
  FloatingPanelContentHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FloatingPanelContentHeaderActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FloatingPanelContentTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  FloatingPanelClose: () => <button type='button'>Close</button>,
}));

vi.mock('@taucad/ui/components/key-shortcut', () => ({
  KeyShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('#routes/w.$workspace.$project/use-chat-interface-state.js', () => ({
  usePaneviewPersistence: () => ({
    savedState: {},
    connectApi: vi.fn(),
  }),
}));

vi.mock('#components/files/export-selector.js', () => ({
  ExportSelector: () => <div data-testid='export-selector'>ExportSelector</div>,
}));

type ProjectSource = ReturnType<typeof useProjectParametersSource>;

/** The project's Parameters source, as the measures pane receives it. */
const projectSource = (): ProjectSource => renderHook(() => useProjectParametersSource()).result.current;

const resetProject = (): void => {
  mockGeometryUnits = new Map<string, ActorRefFrom<typeof cadMachine>>();
  mockSetParameters.mockClear();
  mockSetGeometryUnitParameters.mockClear();
  mockSwitchParameterGroup.mockClear();
  mockProjectSend.mockClear();
  mockEditorSend.mockClear();
  mockResolveParameterEntry.mockClear();
  mockParameterState = 'ready';
  mockParameterActorSend.mockClear();
  availability.current = 'ready';
  paneSource.current = undefined;
  vi.mocked(mockCadRef.send).mockClear();
  mockParameterEntries = new Map<string, FileParameterEntry>([
    ['main.ts', { activeGroup: 'default', groups: { default: { values: { width: 15 } } } }],
  ]);
};

describe('ChatParameters', () => {
  beforeEach(resetProject);

  it('titles the panel and hands the measures pane the project source', () => {
    mockGeometryUnits.set('main.ts', mockCadRef);

    render(<ChatParameters isExpanded setIsExpanded={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Pieces and measures' })).toBeInTheDocument();
    expect(screen.getByTestId('piece-measures-pane')).toBeInTheDocument();
    expect(paneSource.current).toEqual(expect.objectContaining({ useEntry: expect.any(Function) }));
  });

  it('shows the sync placeholder instead of the pane while the project files are not on this device', () => {
    availability.current = 'downloading';

    render(<ChatParameters isExpanded setIsExpanded={vi.fn()} />);

    expect(screen.getByTestId('sync-placeholder')).toHaveTextContent('downloading');
    expect(screen.queryByTestId('piece-measures-pane')).not.toBeInTheDocument();
  });
});

describe('project parameters source', () => {
  beforeEach(resetProject);

  it('names the main entry «Model» and any other entry by its file name without the extension', () => {
    const source = projectSource();

    expect(source.entryTitle?.('main.ts')).toBe('Model');
    expect(source.entryTitle?.('lib/helper.scad')).toBe('helper');
  });

  it('lists every admitted geometry unit and none when the project has no unit', () => {
    mockGeometryUnits.set('main.ts', mockCadRef);
    mockGeometryUnits.set('helper.ts', mockCadRef2);
    const source = projectSource();
    expect(renderHook(() => source.useEntryPaths?.()).result.current).toEqual(['main.ts', 'helper.ts']);

    mockGeometryUnits = new Map();
    expect(renderHook(() => source.useEntryPaths?.()).result.current).toEqual([]);
  });

  it('reads the entry from the authority actor active group and the manifest from the unit', () => {
    mockGeometryUnits.set('main.ts', mockCadRef);
    const source = projectSource();

    const { result } = renderHook(() => source.useEntry('main.ts'));

    expect(result.current.entry?.groups['default']?.values).toEqual({ width: 15 });
    expect(result.current.manifest?.defaults).toEqual({ width: 10, height: 20 });
    expect(result.current.failure).toBeUndefined();
    // The authority already holds this manifest revision, so nothing is resolved again.
    expect(mockResolveParameterEntry).not.toHaveBeenCalled();
  });

  it('resolves the authority entry again when the unit republishes a different manifest revision', () => {
    mockGeometryUnits.set('helper.ts', mockCadRef2);
    const source = projectSource();

    renderHook(() => source.useEntry('helper.ts'));

    expect(mockResolveParameterEntry).toHaveBeenCalledWith(
      'helper.ts',
      expect.objectContaining({ revision: 'manifest-2' }),
    );
  });

  it('reads an empty record when the entry has none', () => {
    mockParameterEntries = new Map();
    mockGeometryUnits.set('main.ts', mockCadRef);
    const source = projectSource();

    const { result } = renderHook(() => source.useEntry('main.ts'));

    expect(result.current.entry?.groups['default']?.values).toEqual({});
  });

  it('reports the authority failure and retries by resolving the entry again while the write outcome is uncertain', () => {
    mockParameterState = 'uncertain';
    mockGeometryUnits.set('main.ts', mockCadRef);
    const source = projectSource();

    const { result } = renderHook(() => source.useEntry('main.ts'));
    expect(result.current.failure).toEqual({
      code: 'WRITE_UNCERTAIN',
      message: 'The last write could not be confirmed.',
    });

    source.retry?.('main.ts', result.current.manifest);
    expect(mockParameterActorSend).toHaveBeenCalledWith({ type: 'resolve', resolution: {} });
  });

  it('replaces the active group values on the unit', async () => {
    mockGeometryUnits.set('main.ts', mockCadRef);
    const source = projectSource();
    const { result } = renderHook(() => source.useEntry('main.ts'));

    await source.replaceValues('main.ts', result.current.manifest!, { width: 42 });

    expect(mockSetGeometryUnitParameters).toHaveBeenCalledWith(
      'main.ts',
      expect.objectContaining({ defaults: { width: 10, height: 20 } }),
      { width: 42 },
    );
  });

  it('forwards the group operations, shows the entry in a viewer and closes it, but never opens the source', () => {
    const source = projectSource();
    const manifest = mockCadRef.getSnapshot().context.parameterManifest!;

    source.groups?.select('main.ts', manifest, 'preset1');
    expect(mockSwitchParameterGroup).toHaveBeenCalledWith('main.ts', manifest, 'preset1');

    source.openInViewer?.('main.ts');
    expect(mockProjectSend).toHaveBeenCalledWith({ type: 'openInViewer', entryPath: 'main.ts' });
    source.closeEntry?.('helper.ts');
    expect(mockProjectSend).toHaveBeenCalledWith({ type: 'destroyGeometryUnit', entryPath: 'helper.ts' });

    // SinopiaCAD: Misure never leads to the code; developers open it from the command palette.
    expect(source.openInEditor).toBeUndefined();
    expect(mockEditorSend).not.toHaveBeenCalled();
  });
});

describe('project parameters scrub lane', () => {
  beforeEach(resetProject);

  const field = { pointer: '/width', value: '21 in' } as const;
  const isScrubSent = (unit: ActorRefFrom<typeof cadMachine>): boolean =>
    vi.mocked(unit.send).mock.calls.some(([event]) => event.type === 'scrubParameters');
  const withImmediateFrames = (): (() => void) => {
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    return () => {
      requestFrame.mockRestore();
    };
  };

  it('should send only the dragged source-unit field through the scrub lane', () => {
    const restore = withImmediateFrames();
    mockGeometryUnits.set('main.ts', mockCadRef);
    const source = projectSource();

    const { result } = renderHook(() => source.useScrub?.('main.ts'));
    result.current?.scrub?.(field);

    expect(mockCadRef.send).toHaveBeenCalledWith({ type: 'scrubParameters', parameters: { width: '21 in' } });
    restore();
  });

  it('should send the last sample once more as settled when the drag holds still, and not after it ends', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      mockGeometryUnits.set('main.ts', mockCadRef);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));
      const settled = { type: 'scrubParameters', parameters: { width: '21 in' }, settled: true };

      result.current?.scrub?.(field);
      vi.advanceTimersByTime(200);
      result.current?.scrub?.({ pointer: '/width', value: '22 in' });
      vi.advanceTimersByTime(200);
      // Still moving: every sample restarts the pause, so nothing has settled yet.
      expect(mockCadRef.send).toHaveBeenCalledWith({ type: 'scrubParameters', parameters: { width: '22 in' } });
      expect(mockCadRef.send).not.toHaveBeenCalledWith(expect.objectContaining({ settled: true }));

      vi.advanceTimersByTime(100);
      expect(mockCadRef.send).toHaveBeenLastCalledWith({ ...settled, parameters: { width: '22 in' } });
      vi.advanceTimersByTime(1000);
      expect(vi.mocked(mockCadRef.send).mock.calls.filter(([event]) => 'settled' in event)).toHaveLength(1);

      // A drag that ends before the pause sends no settled sample.
      vi.mocked(mockCadRef.send).mockClear();
      result.current?.scrub?.(field);
      vi.advanceTimersByTime(50);
      void result.current?.endScrub?.();
      vi.advanceTimersByTime(1000);
      expect(mockCadRef.send).toHaveBeenCalledWith({ type: 'scrubParameters', parameters: { width: '21 in' } });
      expect(mockCadRef.send).not.toHaveBeenCalledWith(expect.objectContaining({ settled: true }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('should keep a kernel that cannot cancel off the drag lane until its last render fits the budget', () => {
    const restore = withImmediateFrames();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const unit = createUncancellableCadRef();
      mockGeometryUnits.set('main.ts', unit.ref);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));
      expect(result.current?.scrub).toBeUndefined();

      act(() => {
        now = 1000;
        unit.enter('rendering');
        now = 1400;
        unit.enter('idle');
      });
      expect(result.current?.scrub).toBeUndefined();
      expect(isScrubSent(unit.ref)).toBe(false);

      act(() => {
        now = 2000;
        unit.enter('rendering');
        now = 2040;
        unit.enter('idle');
      });
      result.current?.scrub?.(field);
      expect(unit.ref.send).toHaveBeenCalledWith({ type: 'scrubParameters', parameters: { width: '21 in' } });
    } finally {
      clock.mockRestore();
      restore();
    }
  });

  it('should time from the first rendering status when the same request is re-emitted', () => {
    const restore = withImmediateFrames();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const unit = createUncancellableCadRef();
      mockGeometryUnits.set('main.ts', unit.ref);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));
      act(() => {
        now = 1000;
        unit.enter('rendering');
        now = 1260;
        unit.repeatRendering();
        now = 1300;
        unit.enter('idle');
      });
      expect(result.current?.scrub).toBeUndefined();
      act(() => {
        now = 2000;
        unit.enter('rendering');
        now = 2040;
        unit.enter('idle');
      });
      result.current?.scrub?.(field);
      expect(isScrubSent(unit.ref)).toBe(true);
    } finally {
      clock.mockRestore();
      restore();
    }
  });

  it('should time the replacement when a render request is superseded', () => {
    const restore = withImmediateFrames();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const unit = createUncancellableCadRef();
      mockGeometryUnits.set('main.ts', unit.ref);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));
      act(() => {
        now = 1000;
        unit.enter('rendering');
        now = 1400;
        unit.supersede();
        now = 1440;
        unit.enter('idle');
      });
      result.current?.scrub?.(field);
      expect(unit.ref.send).toHaveBeenCalledWith({ type: 'scrubParameters', parameters: { width: '21 in' } });
    } finally {
      clock.mockRestore();
      restore();
    }
  });

  it('should not restore the old record when a cancelled second gesture ends while the first final is committing', async () => {
    const restore = withImmediateFrames();
    try {
      const final = Promise.withResolvers<boolean>();
      mockGeometryUnits.set('main.ts', mockCadRef);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));

      result.current?.scrub?.(field);
      void result.current?.endScrub?.(final.promise);
      void result.current?.endScrub?.();

      expect(mockCadRef.send).not.toHaveBeenCalledWith({ type: 'restoreParameters' });
      await act(async () => {
        final.resolve(true);
        await final.promise;
      });
      expect(mockCadRef.send).not.toHaveBeenCalledWith({ type: 'restoreParameters' });
    } finally {
      restore();
    }
  });

  it('should restore the committed record when the scrub final is refused', async () => {
    const restore = withImmediateFrames();
    try {
      const final = Promise.withResolvers<boolean>();
      mockGeometryUnits.set('main.ts', mockCadRef);
      const source = projectSource();
      const { result } = renderHook(() => source.useScrub?.('main.ts'));

      result.current?.scrub?.(field);
      void result.current?.endScrub?.(final.promise);
      expect(mockCadRef.send).not.toHaveBeenCalledWith({ type: 'restoreParameters' });

      await act(async () => {
        final.resolve(false);
        await final.promise;
      });
      expect(mockCadRef.send).toHaveBeenCalledWith({ type: 'restoreParameters' });
    } finally {
      restore();
    }
  });
});
