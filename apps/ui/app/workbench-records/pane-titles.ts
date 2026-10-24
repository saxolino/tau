import type { WorkbenchLaneTab } from '@taucad/workbench';
import type { Language } from '#i18n/language.js';
import { translate } from '#i18n/translate.js';

type PaneId = Extract<WorkbenchLaneTab, { kind: 'pane' }>['pane'];

const titles = {
  browser: 'Browser',
  // SinopiaCAD: the parameters a designer adjusts are the piece's measurements.
  parameters: 'Misure',
  model: 'Model',
  print: 'Print',
  kinematics: 'Kinematics',
  revisions: 'Revisions',
  agents: 'Agents',
  jobs: 'Jobs',
  export: 'Export',
  share: 'Share',
  details: 'Details',
  kernel: 'Telemetry',
  console: 'Console',
} as const satisfies Record<PaneId, string>;

/** The panes a designer meets, named in the interface language; the rest keep Tau's names for now. */
const translatedPanes = {
  parameters: 'project.panes.parameters',
  model: 'project.panes.model',
  revisions: 'project.panes.revisions',
  export: 'project.panes.export',
  share: 'project.panes.share',
  // The optional tools a designer can switch on (Impostazioni › Strumenti).
  kinematics: 'project.panes.kinematics',
  details: 'project.panes.details',
  print: 'project.panes.print',
} as const satisfies Partial<Record<PaneId, string>>;

const isTranslatedPane = (pane: string): pane is keyof typeof translatedPanes => Object.hasOwn(translatedPanes, pane);

/**
 * The stored title of a built-in workbench pane (layouts, the + picker, tool summaries); record IDs remain lowercase.
 * A tab shows {@link paneTabTitle} instead, in the interface language.
 *
 * @param pane - The pane.
 * @returns Its stored title.
 */
export const paneTitle = (pane: PaneId): string => titles[pane];

/**
 * The pane title a tab shows, from the panel's component: a built-in pane named in the interface language, nothing
 * for a file or anything else (its stored title stays).
 *
 * @param component - The panel's component id.
 * @param language - The interface language.
 * @returns The title, or `undefined`.
 */
export const paneTabTitle = (component: string, language: Language): string | undefined =>
  isTranslatedPane(component) ? translate(language, translatedPanes[component]) : undefined;
