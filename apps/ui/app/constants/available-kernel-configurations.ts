import { kernelConfigurations } from '@taucad/types/constants';
import type { KernelConfiguration, KernelEntry } from '@taucad/types/constants';
import { desktopBridge } from '#filesystem/desktop-bridge.js';
import { sinopiaKernelIds } from '#lib/sinopia-engines.js';

/** Product offerings executable by the active runtime host. */
const executableKernelConfigurations = (): readonly KernelEntry[] => {
  const advertised = new Set(desktopBridge()?.runtimeKernelIds ?? []);
  return kernelConfigurations.filter((configuration) => {
    const required = 'requiresRuntimeKernelId' in configuration ? configuration.requiresRuntimeKernelId : undefined;
    return !required || advertised.has(required);
  });
};

/** The offerings SinopiaCAD offers that the active runtime host executes, its default engine first. */
export const availableKernelConfigurations = (): readonly KernelEntry[] => {
  const executable = executableKernelConfigurations();
  return sinopiaKernelIds.flatMap((kernelId) => executable.filter(({ id }) => id === kernelId));
};

/** Whether one persisted catalog id is offered and executable by this runtime. */
export const isKernelAvailable = (kernelId: string): boolean =>
  availableKernelConfigurations().some(({ id }) => id === kernelId);

/** Whether this runtime executes one catalog id at all, offered or not: a project written for it still opens. */
export const isKernelExecutable = (kernelId: string): boolean =>
  executableKernelConfigurations().some(({ id }) => id === kernelId);

/** Resolve the native runtime requirement declared by the product catalog for an entry path. */
export const nativeKernelRequirementForEntryPath = (
  entryPath: string,
):
  | {
      readonly configuration: KernelConfiguration;
      readonly runtimeKernelId: string;
    }
  | undefined => {
  const extension = entryPath.split('.').at(-1)?.toLowerCase();
  const configuration = kernelConfigurations.find(
    ({ mainFile }) => extension !== undefined && mainFile.toLowerCase().endsWith(`.${extension}`),
  ) as KernelConfiguration | undefined;
  if (!configuration?.requiresRuntimeKernelId) {
    return undefined;
  }
  return { configuration, runtimeKernelId: configuration.requiresRuntimeKernelId };
};
