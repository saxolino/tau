/**
 * The name a project gets when nobody gave it one. SinopiaCAD speaks Italian and its projects become Sinopia projects:
 * Tau's English «New Project» (or «Untitled …») must never reach Sinopia's dashboard.
 */
export const defaultProjectName = 'Nuovo progetto';

/** The placeholder names Tau, its naming model or Sinopia write when there is no real name (compared lowercase). */
const placeholderNames: ReadonlySet<string> = new Set([
  'new project',
  'untitled',
  'untitled project',
  'untitled import',
  'untitled design',
  'nuovo progetto',
]);

/**
 * Whether a name says nothing about the piece: empty, or one of the placeholders above.
 *
 * @param name - The name to judge.
 * @returns True for a placeholder.
 */
export function isPlaceholderProjectName(name: string | undefined): boolean {
  const trimmed = (name ?? '').trim().replaceAll(/\s+/gu, ' ').toLowerCase();
  return trimmed === '' || placeholderNames.has(trimmed);
}

/**
 * A real name, or the default: the piece's name («Fibbia 30 mm», the assistant's), never an English placeholder.
 *
 * @param name - The candidate name.
 * @param fallback - What a placeholder becomes.
 * @returns At most 200 characters, never empty.
 */
export function projectNameOrDefault(name: string | undefined, fallback = defaultProjectName): string {
  if (isPlaceholderProjectName(name)) {
    return fallback;
  }
  return (name ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 200);
}
