import { useMemo } from 'react';
import { ObservationService } from '@taucad/fs-client/observation-service';
import { useObservation } from '@taucad/fs-client/react/use-observation';
import { useFileManager } from '#hooks/use-file-manager.js';
import { readSinopiaDeliveries, sinopiaSentDirectory } from '#services/sinopia-send.js';
import type { SinopiaDeliveryEvent } from '#services/sinopia-send.js';

type Files = ReturnType<typeof useFileManager>['recordFiles'];
type Watch = ReturnType<typeof useFileManager>['watchRecordFile'];
const sources = new WeakMap<Files, WeakMap<Watch, Map<string, ObservationService<SinopiaDeliveryEvent[]>>>>();
const emptyEvents: SinopiaDeliveryEvent[] = [];

function deliveriesFor(files: Files, watch: Watch, projectId: string): ObservationService<SinopiaDeliveryEvent[]> {
  let watchers = sources.get(files);
  if (!watchers) {
    watchers = new WeakMap();
    sources.set(files, watchers);
  }
  let projects = watchers.get(watch);
  if (!projects) {
    projects = new Map();
    watchers.set(watch, projects);
  }
  let service = projects.get(projectId);
  if (!service) {
    service = new ObservationService({
      resource: sinopiaSentDirectory(projectId),
      watch: (invalidate, reset) =>
        watch(
          sinopiaSentDirectory(projectId),
          (event) => {
            if (event.type === 'reset') {
              reset();
            } else {
              invalidate();
            }
          },
          { recursive: true },
        ),
      read: async () => readSinopiaDeliveries(files, projectId),
    });
    projects.set(projectId, service);
  }
  return service;
}

/** Project-scoped delivery history follows the existing record watcher, including writes from another tab. */
export function useSinopiaSendEvents(projectId: string): { events: SinopiaDeliveryEvent[]; error: string | undefined } {
  const { recordFiles, watchRecordFile } = useFileManager();
  const service = useMemo(
    () => deliveriesFor(recordFiles, watchRecordFile, projectId),
    [projectId, recordFiles, watchRecordFile],
  );
  const snapshot = useObservation(service);
  return { events: snapshot.value ?? emptyEvents, error: snapshot.error };
}
