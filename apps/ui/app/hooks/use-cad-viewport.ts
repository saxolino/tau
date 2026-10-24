import { useSyncExternalStore } from 'react';

const phoneQuery = '(max-width: 743px)';
const tabletQuery = '(max-width: 1366px)';
const subscribe = (notify: () => void): (() => void) => {
  const queries = [phoneQuery, tabletQuery].map((query) => globalThis.matchMedia(query));
  for (const query of queries) {
    query.addEventListener('change', notify);
  }
  return () => {
    for (const query of queries) {
      query.removeEventListener('change', notify);
    }
  };
};
const snapshot = (): 'phone' | 'tablet' | 'desktop' => {
  if (globalThis.matchMedia(phoneQuery).matches) {
    return 'phone';
  }
  return globalThis.matchMedia(tabletQuery).matches ? 'tablet' : 'desktop';
};

/** Reports the supported CAD layout, updating on rotation and window resize. */
export function useCadViewport(): 'phone' | 'tablet' | 'desktop' {
  return useSyncExternalStore(subscribe, snapshot, () => 'desktop');
}
