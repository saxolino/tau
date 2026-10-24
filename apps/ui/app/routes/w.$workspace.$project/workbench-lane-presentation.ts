import type { WorkbenchLaneNode } from '@taucad/workbench';

/** SinopiaCAD's workbench lane when it holds nothing else: the Misure pane (the `parameters` pane) alone. */
export const misureWorkbenchNode: WorkbenchLaneNode = { kind: 'group', tabs: [{ kind: 'pane', pane: 'parameters' }] };

const hasTabs = (node: WorkbenchLaneNode): boolean =>
  node.kind === 'group' ? node.tabs.length > 0 : node.children.some(hasTabs);

/** The node with `size` taken from `size` (its place among the parent's children), omitted when undefined. */
const sized = (node: WorkbenchLaneNode, size: number | undefined): WorkbenchLaneNode => {
  if (node.kind === 'group') {
    const { size: _size, ...group } = node;
    return size === undefined ? group : { ...group, size };
  }
  const { size: _size, ...split } = node;
  return size === undefined ? split : { ...split, size };
};

/**
 * The lane without the file tabs `isShown` refuses. A group that loses all its tabs leaves its split; a split left
 * with one child becomes that child, in the split's place.
 *
 * @param node - A workbench lane arrangement.
 * @param isShown - Whether a file tab stays.
 * @returns The arrangement, the same object when nothing was removed, or `undefined` when nothing remains.
 */
const withoutHiddenFiles = (
  node: WorkbenchLaneNode,
  isShown: (path: string) => boolean,
): WorkbenchLaneNode | undefined => {
  if (node.kind === 'group') {
    const tabs = node.tabs.filter((tab) => tab.kind !== 'file' || isShown(tab.path));
    if (tabs.length === node.tabs.length) {
      return node;
    }
    if (tabs.length === 0) {
      return undefined;
    }
    const { active: _active, ...rest } = node;
    const activeTab = node.active === undefined ? undefined : node.tabs[node.active];
    const active = activeTab === undefined ? -1 : tabs.indexOf(activeTab);
    return active === -1 ? { ...rest, tabs } : { ...rest, tabs, active };
  }
  const children = node.children.flatMap((child) => {
    const kept = withoutHiddenFiles(child, isShown);
    return kept === undefined ? [] : [kept];
  });
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return sized(children[0]!, node.size);
  }
  return children.length === node.children.length && children.every((child, index) => child === node.children[index])
    ? node
    : { ...node, children };
};

/**
 * What the Misure lane shows of a stored arrangement. SinopiaCAD's users design pieces, not code: a file tab
 * (`main.ts` and its file tree among them) appears only once the person opened that file in this window — from the
 * command palette — so neither reopening the project nor the agent arranging the workbench brings code back on its
 * own. A lane left empty shows Misure.
 *
 * @param node - The workbench lane as `layout.json` stores it.
 * @param openPaths - The files open in this window's editor state.
 * @returns The arrangement to adopt.
 */
export function presentWorkbenchNode(node: WorkbenchLaneNode, openPaths: ReadonlySet<string>): WorkbenchLaneNode {
  const shown = withoutHiddenFiles(node, (path) => openPaths.has(path));
  return shown === undefined || !hasTabs(shown) ? misureWorkbenchNode : shown;
}
