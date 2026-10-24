import { Check, Focus } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { useViewerLabels } from '#environment/viewer-environment.jsx';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { useGraphics, useGraphicsSelector } from '#hooks/use-graphics.jsx';
import { useTickAnimation } from '@taucad/ui/hooks/use-tick-animation';

type FitViewControlProps = Readonly<{
  /** The formatted shortcut the tooltip shows. */
  shortcut?: string;
}>;

/**
 * Fit view control button: zooms and recentres on the model without rotating the camera.
 * Uses the per-view graphics actor from GraphicsProvider.
 * @public
 */
export function FitViewControl({ shortcut }: FitViewControlProps): React.JSX.Element {
  const graphicsRef = useGraphics();
  const canFit = useGraphicsSelector(
    (state) => state.context.geometryRadius > 0 || state.context.artifact?.mimeType === 'image/svg+xml',
  );
  const { ticked, trigger } = useTickAnimation();
  const labels = useViewerLabels();

  const handleFit = (): void => {
    graphicsRef.send({ type: 'fitView' });
    trigger();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={labels.fitView}
          aria-disabled={!canFit}
          // Labelled from 520 px of viewer width, as the tool toggles are.
          className='gap-1 text-xs @min-[520px]/viewer:w-auto @min-[520px]/viewer:px-2'
          onClick={canFit ? handleFit : undefined}
        >
          {ticked ? <Check className='size-4 text-success' /> : <Focus className='size-4' />}
          <span className='hidden @min-[520px]/viewer:inline'>{labels.fitViewLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {canFit ? (ticked ? labels.viewFitted : labels.fitView) : labels.unavailableWithoutModel}
        {shortcut ? (
          <KeyShortcut variant='tooltip' className='ml-1'>
            {shortcut}
          </KeyShortcut>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
