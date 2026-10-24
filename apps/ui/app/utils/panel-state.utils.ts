import type { PartialDeep } from 'type-fest';
import type { EditorState, PanelState } from '#types/editor.types.js';
import { desktopLayoutRevision } from '#constants/editor.constants.js';

/**
 * Bring a stored panel state to the current lane arrangement before it merges with the defaults. Lane widths stored
 * before `desktopLayoutRevision` measured Tau's arrangement (the chat on the left, a 420 px code workbench on the
 * right); they are dropped once so the defaults apply. Which lanes are open is the person's choice and is kept.
 *
 * @param stored - The panel state as storage returned it.
 * @returns The same state when it is current; otherwise a copy without the old widths, marked current.
 */
export const migratePanelState = (stored: PartialDeep<PanelState>): PartialDeep<PanelState> => {
  const desktopLayout = stored.desktopLayout as Partial<PanelState['desktopLayout']> | undefined;
  if (desktopLayout?.layoutRevision === desktopLayoutRevision) {
    return stored;
  }
  const { chatWidth: _chatWidth, workbenchWidth: _workbenchWidth, ...lanes } = desktopLayout ?? {};
  return { ...stored, desktopLayout: { ...lanes, layoutRevision: desktopLayoutRevision } };
};

export const mergePanelState = (current: PanelState, update?: PartialDeep<PanelState>): PanelState => {
  const desktopLayout = update?.desktopLayout as Partial<PanelState['desktopLayout']> | undefined;
  return {
    desktopLayout: {
      chatOpen: desktopLayout?.chatOpen ?? current.desktopLayout.chatOpen,
      workbenchOpen: desktopLayout?.workbenchOpen ?? current.desktopLayout.workbenchOpen,
      chatWidth: desktopLayout?.chatWidth ?? current.desktopLayout.chatWidth,
      workbenchWidth: desktopLayout?.workbenchWidth ?? current.desktopLayout.workbenchWidth,
      compactAuxiliary: desktopLayout?.compactAuxiliary ?? current.desktopLayout.compactAuxiliary,
      layoutRevision: desktopLayout?.layoutRevision ?? current.desktopLayout.layoutRevision,
    },
    mobileActiveTab: update?.mobileActiveTab ?? current.mobileActiveTab,
    kernelPaneview: {
      ...current.kernelPaneview,
      ...(update?.kernelPaneview as PanelState['kernelPaneview'] | undefined),
    },
    modelPaneview: {
      ...current.modelPaneview,
      ...(update?.modelPaneview as PanelState['modelPaneview'] | undefined),
    },
    parametersPaneview: {
      ...current.parametersPaneview,
      ...(update?.parametersPaneview as PanelState['parametersPaneview'] | undefined),
    },
    consolePaneview: {
      ...current.consolePaneview,
      ...(update?.consolePaneview as PanelState['consolePaneview'] | undefined),
    },
  };
};

/**
 * A stored editor state as SinopiaCAD opens a project: on its model, without the file tabs (`main.ts` among them) an
 * earlier visit left open. A developer reopens the code from the command palette.
 *
 * @param state - The editor state as storage returned it.
 * @returns The same state with no open files and no active file tab.
 */
export const withoutRestoredFileTabs = (state: EditorState): EditorState => ({
  ...state,
  openFiles: [],
  activePaneId: undefined,
});
