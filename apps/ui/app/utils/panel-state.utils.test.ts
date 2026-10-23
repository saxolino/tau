import { describe, expect, it } from 'vitest';
import { defaultPanelState, desktopLayoutRevision } from '#constants/editor.constants.js';
import type { EditorState } from '#types/editor.types.js';
import { mergePanelState, migratePanelState, withoutRestoredFileTabs } from '#utils/panel-state.utils.js';

describe('migratePanelState', () => {
  it('drops the widths of Tau’s code-first arrangement once, keeping which lanes are open', () => {
    const stored: Parameters<typeof migratePanelState>[0] = {
      desktopLayout: {
        chatOpen: false,
        workbenchOpen: true,
        chatWidth: 320,
        workbenchWidth: 420,
        compactAuxiliary: 'workbench',
      },
      mobileActiveTab: 'viewer',
    };

    const migrated = mergePanelState(defaultPanelState, migratePanelState(stored));

    expect(migrated.desktopLayout).toEqual({
      chatOpen: false,
      workbenchOpen: true,
      chatWidth: defaultPanelState.desktopLayout.chatWidth,
      workbenchWidth: 280,
      compactAuxiliary: 'workbench',
      layoutRevision: desktopLayoutRevision,
    });
  });

  it('keeps widths the person set in the current arrangement', () => {
    const stored = {
      desktopLayout: { ...defaultPanelState.desktopLayout, chatWidth: 360, workbenchWidth: 300 },
    };

    expect(migratePanelState(stored)).toBe(stored);
    expect(mergePanelState(defaultPanelState, migratePanelState(stored)).desktopLayout).toMatchObject({
      chatWidth: 360,
      workbenchWidth: 300,
    });
  });

  it('marks a state with no desktop layout as current', () => {
    expect(migratePanelState({ mobileActiveTab: 'chat' })).toEqual({
      mobileActiveTab: 'chat',
      desktopLayout: { layoutRevision: desktopLayoutRevision },
    });
  });
});

describe('withoutRestoredFileTabs', () => {
  it('opens the project on its model, without the file tabs an earlier visit left open', () => {
    const state: EditorState = {
      projectId: 'proj_one',
      openFiles: [{ paneId: 'pane_main', path: 'main.ts', name: 'main.ts', lastAccessedAt: 1 }],
      activePaneId: 'pane_main',
      focusedChatId: 'chat_one',
      panelState: defaultPanelState,
      fileSidebars: { 'main.ts': 220 },
      graphicsBackendPreferences: {},
      updatedAt: 2,
    };

    expect(withoutRestoredFileTabs(state)).toEqual({ ...state, openFiles: [], activePaneId: undefined });
    // The rest of the device's state is the person's and stays.
    expect(withoutRestoredFileTabs(state).focusedChatId).toBe('chat_one');
    expect(withoutRestoredFileTabs(state).fileSidebars).toEqual({ 'main.ts': 220 });
  });
});
