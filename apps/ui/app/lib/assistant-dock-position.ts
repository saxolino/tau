/**
 * The three heights of the assistant under the inspector, and how a project remembers the last one.
 *
 * - `line`: the status line and the composer, nothing else; the inspector has the whole lane.
 * - `open`: the line, the body (the model card, the proposals, the last answer) and the composer.
 * - `tall`: the whole conversation, over the inspector (⌃J).
 *
 * The choice is kept per project in `localStorage`, read and written behind try/catch like the rest of the app: a
 * blocked store means the default, never a broken page.
 */

export const assistantDockPositions = ['line', 'open', 'tall'] as const;

/** One of the three heights. */
export type AssistantDockPosition = (typeof assistantDockPositions)[number];

/** How the assistant opens with a project that never chose: the line, the body and the composer. */
export const defaultAssistantDockPosition: AssistantDockPosition = 'open';

const storageKey = (projectId: string): string => `sinopiacad.assistant-dock.${projectId}`;

const isPosition = (value: unknown): value is AssistantDockPosition =>
  typeof value === 'string' && (assistantDockPositions as readonly string[]).includes(value);

/**
 * The height the project last chose, or the default.
 *
 * @param projectId - The project.
 * @returns The height.
 */
export const readAssistantDockPosition = (projectId: string): AssistantDockPosition => {
  try {
    const stored = globalThis.localStorage.getItem(storageKey(projectId));
    return isPosition(stored) ? stored : defaultAssistantDockPosition;
  } catch {
    return defaultAssistantDockPosition;
  }
};

/**
 * Remember the height for the project; a blocked store is ignored.
 *
 * @param projectId - The project.
 * @param position - The height to remember.
 */
export const writeAssistantDockPosition = (projectId: string, position: AssistantDockPosition): void => {
  try {
    globalThis.localStorage.setItem(storageKey(projectId), position);
  } catch {
    // Persistence is best-effort.
  }
};

/**
 * The height one step up or down from the current one; the ends stay where they are.
 *
 * @param position - The current height.
 * @param direction - Up grows the assistant, down shrinks it.
 * @returns The next height.
 */
export const stepAssistantDockPosition = (
  position: AssistantDockPosition,
  direction: 'up' | 'down',
): AssistantDockPosition => {
  const index = assistantDockPositions.indexOf(position);
  const next = direction === 'up' ? index + 1 : index - 1;
  return assistantDockPositions[Math.min(assistantDockPositions.length - 1, Math.max(0, next))] ?? position;
};

/** How far the line must be dragged, in CSS pixels, before the assistant changes height. */
export const assistantDockDragThreshold = 28;

/**
 * What a drag of the line does, from how far it moved vertically: pulling it up grows the assistant, pushing it down
 * shrinks it, and a short move does nothing.
 *
 * @param deltaY - The pointer's vertical travel since the drag began (negative is up).
 * @returns The direction, or `undefined` for a move under the threshold.
 */
export const assistantDockDragDirection = (deltaY: number): 'up' | 'down' | undefined => {
  if (deltaY <= -assistantDockDragThreshold) {
    return 'up';
  }
  if (deltaY >= assistantDockDragThreshold) {
    return 'down';
  }
  return undefined;
};
