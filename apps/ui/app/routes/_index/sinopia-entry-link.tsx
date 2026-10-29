import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { useCloudProjects } from '#hooks/use-cloud-projects.js';
import { sinopiaOpenErrorMessage, useOpenCloudProject } from '#hooks/use-open-cloud-project.js';
import { useProjects } from '#hooks/use-projects.js';
import { useTranslation } from '#i18n/translate.js';
import { toast } from '#components/ui/sonner.js';

/** Sinopia's links «Apri nel CAD» carry UUIDs; anything else in the address is ignored. */
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const readId = (value: string | null): string | undefined =>
  value !== null && uuidPattern.test(value) ? value : undefined;

/** Every parameter an «Apri nel CAD» link brings: they leave the address together, never one at a time. */
const entryParameters = [
  searchParameterName.sinopiaProject,
  searchParameterName.sinopiaModel,
  searchParameterName.sinopiaSection,
] as const;

/**
 * The entry parameters Sinopia's «Apri nel CAD» links carry: `?project=<id>` (the Sinopia project to start from),
 * `?model=<id>` (a CAD model of the account) and, with it, `?sezione=foto`. Only UUIDs are read. `consume` takes all
 * of them off the address at once, so a reload or Back does not start the same thing twice.
 *
 * `consume` reads the address as it is when it runs, not as it was when the callback was made: react-router's
 * `setSearchParams(fn)` hands `fn` the parameters of the render that created the setter, so a callback held across an
 * await (the model opener's `onSpent`) used to write back a `?project=` another consumer had already removed, and the
 * project's image sheet opened again over the model (29 Oct).
 *
 * @returns The ids found in the address and how to take them off it.
 */
export function useSinopiaEntryLink(): Readonly<{
  projectId: string | undefined;
  modelId: string | undefined;
  /** With `model`: the section to open it on (`foto` from Sinopia's «Fai lo shooting» with no photo yet). */
  section: 'foto' | undefined;
  consume: () => void;
}> {
  const [parameters, setParameters] = useSearchParams();
  // The committed address, for callbacks made by an earlier render.
  const current = useRef(parameters);
  useLayoutEffect(() => {
    current.current = parameters;
  }, [parameters]);
  const consume = useCallback((): void => {
    const next = new URLSearchParams(current.current);
    if (entryParameters.every((name) => !next.has(name))) {
      return;
    }
    for (const name of entryParameters) {
      next.delete(name);
    }
    current.current = next;
    setParameters(next, { replace: true });
  }, [setParameters]);
  return {
    projectId: readId(parameters.get(searchParameterName.sinopiaProject)),
    modelId: readId(parameters.get(searchParameterName.sinopiaModel)),
    section: parameters.get(searchParameterName.sinopiaSection) === 'foto' ? 'foto' : undefined,
    consume,
  };
}

/**
 * Open the account's CAD model named by `?model=<id>` the way «I tuoi progetti» opens a Sinopia model (the local copy
 * when this device has it, otherwise the saved snapshot from `cad_models`). Rendered only while the parameter is
 * present. A model the account does not have (or that was deleted) says so and clears the parameter.
 *
 * It starts only once both listings have answered: the account's models on Sinopia and the projects of this device. In
 * a tab opened cold the device's listing arrives after Sinopia's, and opening before it took a held model for a missing
 * one (its link record unreadable yet: `SINOPIA_MODEL_IDENTITY_MISMATCH`). A failure says what went wrong.
 *
 * @param properties - The model id and what to do once the link is spent.
 * @returns Nothing visible.
 */
export function OpenSinopiaModelFromLink({
  modelId,
  onSpent,
}: Readonly<{ modelId: string; onSpent: () => void }>): undefined {
  const { t } = useTranslation();
  const cloud = useCloudProjects();
  // Same listing (and cache key) as the open verb's own: once it has answered, the verb sees this device's projects.
  const local = useProjects({ includeDeleted: true });
  const openCloudProject = useOpenCloudProject();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      return;
    }
    if (cloud.isFailed) {
      started.current = true;
      toast.error(t('sinopiaImages.cadError'));
      onSpent();
      return;
    }
    if (!cloud.isSettled || cloud.isFetching || local.isLoading) {
      return;
    }
    started.current = true;
    const entry = cloud.projects.find((item) => item.sinopia?.id === modelId);
    if (entry === undefined) {
      toast.error(t('sinopiaImages.modelNotFound'));
      onSpent();
      return;
    }
    // async-iife: bootstrap -- the link is spent whatever the outcome, so a reload never repeats a failed open.
    void (async (): Promise<void> => {
      try {
        await openCloudProject(entry);
      } catch (error) {
        console.error('[sinopia] model link did not open', error);
        toast.error(t(sinopiaOpenErrorMessage(error)));
      } finally {
        onSpent();
      }
    })();
  }, [
    cloud.isFailed,
    cloud.isFetching,
    cloud.isSettled,
    cloud.projects,
    local.isLoading,
    modelId,
    onSpent,
    openCloudProject,
    t,
  ]);
  return undefined;
}
