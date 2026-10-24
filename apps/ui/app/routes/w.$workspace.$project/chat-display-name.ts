import type { Translate } from '#i18n/translate.js';

/** The names Tau gives a conversation before it has one of its own; they are stored in English. */
const placeholderChatNames: ReadonlySet<string> = new Set(['Initial design', 'Initial chat', 'New chat', 'Untitled']);

/**
 * A conversation's name as the agent lane shows it: its own name once it has one, «Agente» while it still carries
 * Tau's English placeholder.
 *
 * @param name - The stored name, if any.
 * @param t - The interface translator.
 * @returns The name to show.
 */
export const displayChatName = (name: string | undefined, t: Translate): string =>
  name === undefined || name.trim() === '' || placeholderChatNames.has(name.trim()) ? t('project.lanes.agent') : name;
