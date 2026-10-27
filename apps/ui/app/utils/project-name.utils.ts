/** The names Tau and Sinopia give a project nobody named yet, stored in English whatever the interface language. */
const placeholderNames = new Set(['new project', 'new-project', 'untitled', 'untitled project', 'untitled-project']);

/**
 * Whether a project's name is a placeholder rather than a name: the interface then says «Senza nome» · "Untitled"
 * in its own language instead of showing the stored English.
 *
 * @param name - The project's stored name.
 * @returns `true` for a placeholder or an empty name.
 */
export const isPlaceholderProjectName = (name: string | undefined): boolean =>
  name === undefined || name.trim() === '' || placeholderNames.has(name.trim().toLowerCase());
