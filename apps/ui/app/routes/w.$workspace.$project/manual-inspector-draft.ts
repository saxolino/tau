import { useCallback, useState } from 'react';

type DraftLayout = 'profile' | 'operation' | undefined;

/** Keep a mounted inspector's draft authoritative while its viewer changes work modes. */
export function useManualInspectorDraft({
  isOpen,
  isActive,
  onDraftLayoutChange,
}: Readonly<{
  isOpen: boolean;
  isActive: boolean;
  onDraftLayoutChange?: (layout: DraftLayout) => void;
}>): Readonly<{
  draftLayout: DraftLayout;
  isToolOpen: boolean;
  onDraftLayoutChange: (layout: DraftLayout) => void;
}> {
  const [draftLayout, setDraftLayout] = useState<DraftLayout>();
  const changeDraftLayout = useCallback(
    (layout: DraftLayout) => {
      setDraftLayout(layout);
      onDraftLayoutChange?.(layout);
    },
    [onDraftLayoutChange],
  );
  return {
    draftLayout,
    isToolOpen: isOpen && isActive && draftLayout === undefined,
    onDraftLayoutChange: changeDraftLayout,
  };
}
