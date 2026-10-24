import { useCallback, useMemo } from 'react';
import { Boxes, FileCode, Import, Info, Printer, Rotate3d, Shuffle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cookieName } from '#constants/cookie.constants.js';
import { isFeatureEnabled } from '#flags/feature-flags.js';
import { useCookie } from '#hooks/use-cookie.js';
import type { WorkbenchPanelId } from '#routes/w.$workspace.$project/project-workspace-context.js';

export type SinopiaToolId = 'convert' | 'import' | 'pieces' | 'kinematics' | 'print' | 'details' | 'code';

/** A Tau function kept for designers: a page reached from the sidebar, or a panel beside «Misure». */
export type SinopiaTool = Readonly<
  {
    id: SinopiaToolId;
    icon: LucideIcon;
    /** On until the designer switches it off. */
    isDefaultOn: boolean;
  } & ({ kind: 'page'; url: string } | { kind: 'panel'; panelId: WorkbenchPanelId })
>;

/** In the order Impostazioni › Strumenti lists them. */
const catalog: readonly SinopiaTool[] = [
  { id: 'convert', kind: 'page', url: '/convert', icon: Shuffle, isDefaultOn: true },
  { id: 'import', kind: 'page', url: '/import', icon: Import, isDefaultOn: true },
  { id: 'pieces', kind: 'panel', panelId: 'model', icon: Boxes, isDefaultOn: false },
  { id: 'kinematics', kind: 'panel', panelId: 'kinematics', icon: Rotate3d, isDefaultOn: false },
  { id: 'print', kind: 'panel', panelId: 'print', icon: Printer, isDefaultOn: false },
  { id: 'details', kind: 'panel', panelId: 'details', icon: Info, isDefaultOn: false },
  { id: 'code', kind: 'panel', panelId: 'files', icon: FileCode, isDefaultOn: false },
];

/** The tools this build can offer: 3D printing needs the printers feature. */
export const sinopiaTools = (): readonly SinopiaTool[] =>
  catalog.filter((tool) => tool.id !== 'print' || isFeatureEnabled('machines'));

type ToolChoices = Partial<Record<SinopiaToolId, boolean>>;
const noChoices: ToolChoices = {};

/**
 * Which optional tools the designer keeps, remembered on this device. Only explicit choices are stored, so a tool's
 * default can change later for everyone who never touched it.
 *
 * @returns The offered tools, the ones switched on, and the switch.
 */
export function useSinopiaTools(): {
  readonly tools: readonly SinopiaTool[];
  readonly enabled: readonly SinopiaTool[];
  readonly isEnabled: (id: SinopiaToolId) => boolean;
  readonly setEnabled: (id: SinopiaToolId, isOn: boolean) => void;
} {
  const [choices, setChoices] = useCookie<ToolChoices>(cookieName.sinopiaTools, noChoices);
  const tools = useMemo(() => sinopiaTools(), []);
  const isEnabled = useCallback(
    (id: SinopiaToolId) => choices[id] ?? tools.find((tool) => tool.id === id)?.isDefaultOn ?? false,
    [choices, tools],
  );
  const setEnabled = useCallback(
    (id: SinopiaToolId, isOn: boolean) => {
      setChoices((previous) => ({ ...previous, [id]: isOn }));
    },
    [setChoices],
  );
  const enabled = useMemo(() => tools.filter((tool) => isEnabled(tool.id)), [isEnabled, tools]);
  return { tools, enabled, isEnabled, setEnabled };
}
