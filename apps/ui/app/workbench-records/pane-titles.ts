import type { WorkbenchLaneTab } from '@taucad/workbench';

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

/** Display title for a built-in workbench pane; record IDs remain lowercase. */
export const paneTitle = (pane: PaneId): string => titles[pane];
