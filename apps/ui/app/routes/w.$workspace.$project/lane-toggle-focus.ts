import { useCallback, useEffect, useRef } from 'react';

/** Where a side lane's toggle is mounted: the lane's own header while it shows, the viewer's tab bar while it does not. */
export type LaneTogglePlace = 'lane' | 'viewer';

/** The side lanes that own a two-place toggle: the Misure lane on the left, the agent lane on the right. */
export type ToggledLane = 'chat' | 'workbench';

/**
 * Which mount of each lane's toggle takes focus next (B-2). A keyboard click on one mount hides it and shows the
 * other, so the claim hands focus across rather than dropping it on `body`.
 */
const focusClaims = new Map<ToggledLane, LaneTogglePlace>();

/**
 * Focus hand-off between the two mounts of one lane's toggle.
 *
 * @param lane - The lane the toggle opens and closes.
 * @param place - Which mount this is.
 * @param isOpen - Whether the lane is on screen.
 * @returns The button's ref, and `claimFocus` to call from its click handler.
 */
export function useLaneToggleFocus(
  lane: ToggledLane,
  place: LaneTogglePlace,
  isOpen: boolean,
): {
  // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React ref object
  readonly ref: React.RefObject<HTMLButtonElement | null>;
  readonly claimFocus: (button: HTMLButtonElement) => void;
} {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusClaims.get(lane) !== place || isOpen !== (place === 'lane')) {
      return;
    }
    // The lane's pane turns visible in Allotment's own layout pass. The claim is spent in the
    // frame, not here, so a cancelled run (StrictMode's double effect) leaves it for the re-run.
    const frame = requestAnimationFrame(() => {
      focusClaims.delete(lane);
      ref.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen, lane, place]);

  const claimFocus = useCallback(
    (button: HTMLButtonElement): void => {
      if (document.activeElement === button) {
        focusClaims.set(lane, place === 'lane' ? 'viewer' : 'lane');
      }
    },
    [lane, place],
  );

  return { ref, claimFocus };
}
