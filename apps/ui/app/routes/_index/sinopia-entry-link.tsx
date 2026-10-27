import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { useCloudProjects } from '#hooks/use-cloud-projects.js';
import { useOpenCloudProject } from '#hooks/use-open-cloud-project.js';
import { useTranslation } from '#i18n/translate.js';
import { toast } from '#components/ui/sonner.js';

/** Sinopia's links «Apri nel CAD» carry UUIDs; anything else in the address is ignored. */
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const readId = (value: string | null): string | undefined =>
  value !== null && uuidPattern.test(value) ? value : undefined;

/**
 * The entry parameters Sinopia's «Apri nel CAD» links carry: `?project=<id>` (the Sinopia project to start from) and
 * `?model=<id>` (a CAD model of the account). Only UUIDs are read; each parameter is consumed once with `consume`, so a
 * reload or Back does not start the same thing twice.
 *
 * @returns The ids found in the address and how to take a parameter off it.
 */
export function useSinopiaEntryLink(): Readonly<{
  projectId: string | undefined;
  modelId: string | undefined;
  consume: (name: 'project' | 'model') => void;
}> {
  const [parameters, setParameters] = useSearchParams();
  const consume = useCallback(
    (name: 'project' | 'model'): void => {
      setParameters(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(searchParameterName[name === 'project' ? 'sinopiaProject' : 'sinopiaModel']);
          return next;
        },
        { replace: true },
      );
    },
    [setParameters],
  );
  return {
    projectId: readId(parameters.get(searchParameterName.sinopiaProject)),
    modelId: readId(parameters.get(searchParameterName.sinopiaModel)),
    consume,
  };
}

/**
 * Open the account's CAD model named by `?model=<id>` the way «I tuoi progetti» opens a Sinopia model (the local copy
 * when this device has it, otherwise the saved snapshot from `cad_models`). Rendered only while the parameter is
 * present. A model the account does not have (or that was deleted) says so and clears the parameter.
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
    if (!cloud.isSettled || cloud.isFetching) {
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
      } catch {
        toast.error(t('sinopiaImages.openError'));
      } finally {
        onSpent();
      }
    })();
  }, [cloud.isFailed, cloud.isFetching, cloud.isSettled, cloud.projects, modelId, onSpent, openCloudProject, t]);
  return undefined;
}
