import { useWorkbenchPanesHost } from '#host/workbench-host.jsx';
import type { ModelPaneLabels } from '#model/model-source.js';
import { englishModelPaneLabels } from '#model/model-source.js';

/**
 * The Model pane's words: its host's, else English.
 *
 * @internal
 * @returns The labels every part of the pane reads.
 */
export function useModelPaneLabels(): ModelPaneLabels {
  return useWorkbenchPanesHost().model?.labels ?? englishModelPaneLabels;
}
