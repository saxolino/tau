import React, { useCallback, useRef, useState, useMemo } from 'react';
import type { ClassValue } from 'clsx';
import {
  Aperture,
  Axis3D,
  Box,
  Grid3X3,
  Layers,
  Rotate3D,
  Settings,
  PenLine,
  Sparkles,
  ArrowUp,
  Timer,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { Button } from '@taucad/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuToggleGroupItem,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { cn } from '@taucad/ui/utils/cn';
import { AxisLabel } from '#cad/section-tool-row.jsx';
import { ModelMaterialMenuRows } from '#cad/model-material-menu.jsx';
import { InfoTooltip } from '@taucad/ui/components/info-tooltip';
import {
  DropdownMenuSelectItem,
  DropdownMenuSliderItem,
  preventMenuSliderEscapeDismissal,
} from '@taucad/ui/components/menu-slider-item';
import { useCameraRig, useCameraSelector, useGraphics, useGraphicsSelector } from '#hooks/use-graphics.jsx';
import { useViewerLabels } from '#environment/viewer-environment.jsx';
import type { SettingsLabels } from '#environment/viewer-environment.jsx';
import { clamp } from '@taucad/ui/utils/number';

// Up direction options
type UpDirection = 'x' | 'y' | 'z';

type TimeoutOption = {
  /** Render timeout. Milliseconds. */
  value: number;
  label: string;
};

const timeoutOptionsOf = (settings: SettingsLabels): TimeoutOption[] => [
  { value: 0, label: settings.timeoutDisabled },
  { value: 15_000, label: settings.seconds(15) },
  { value: 30_000, label: settings.seconds(30) },
  { value: 60_000, label: settings.minutes(1) },
  { value: 180_000, label: settings.minutes(3) },
  { value: 300_000, label: settings.minutes(5) },
  { value: 600_000, label: settings.minutes(10) },
];

const upDirectionOptions: Array<{ value: UpDirection; label: React.ReactNode; ariaLabel: string }> = [
  { value: 'x', label: <AxisLabel axis='x' />, ariaLabel: 'X-up' },
  { value: 'y', label: <AxisLabel axis='y' />, ariaLabel: 'Y-up' },
  { value: 'z', label: <AxisLabel axis='z' />, ariaLabel: 'Z-up' },
];

/** The widest field of view in degrees; 0° is orthographic. */
const maxVerticalFieldOfView = 90;
/** Degrees per arrow-key step while Shift is held. */
const shiftVerticalFieldOfViewStep = 5;

type DropdownMenuContentProps = React.ComponentProps<typeof DropdownMenuContent>;

type ViewerSettingsProps = {
  /**
   * Optional className for styling
   */
  readonly className?: ClassValue;
  /** The side of the trigger the menu opens on. A centred bar opens it upward. */
  readonly side?: DropdownMenuContentProps['side'];
  /** How the menu aligns against the trigger. */
  readonly align?: DropdownMenuContentProps['align'];
  /** The current view's kernel settings, closing the Rendering section; the viewer supplies them per pane. */
  readonly kernelSettings?: React.ReactNode;
  /** The CAD operation timeout row; absent when the embedder runs no CAD operations. */
  readonly operationTimeout?: ViewerOperationTimeout;
};

/**
 * The CAD operation timeout the settings menu edits. All values are milliseconds; 0 disables the timeout.
 *
 * @public
 */
export type ViewerOperationTimeout = Readonly<{
  /** The current timeout. */
  value: number;
  /** The option shown when `value` matches none of the menu's options. */
  defaultValue: number;
  /** Called with the chosen timeout. */
  onChange: (operationTimeout: number) => void;
}>;

/**
 * A tooltip trigger around a menu slider row. The row stops pointer events from bubbling, so Radix's pointer
 * handlers run in the capture phase, where the row cannot stop them.
 */
function SliderRowTrigger({
  onPointerMove,
  onPointerDown,
  ...properties
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div {...properties} onPointerMoveCapture={onPointerMove} onPointerDownCapture={onPointerDown} />;
}

/**
 * The field of view, 0–90° where 0° is orthographic. The row owns its camera subscription, so a scrub re-renders
 * only this row.
 */
function FieldOfViewRow(): React.JSX.Element {
  const { settings } = useViewerLabels();
  const cameraRig = useCameraRig();
  const fieldOfView = useCameraSelector((state) => state.context.view.requestedVerticalFieldOfView);

  // The camera throws on an angle outside its range, so typed values are clamped as well as stepped ones.
  const setFieldOfView = useCallback(
    (value: number) => {
      cameraRig.actorRef.send({
        type: 'setVerticalFieldOfView',
        verticalFieldOfView: clamp(Math.round(value), 0, maxVerticalFieldOfView),
      });
    },
    [cameraRig],
  );

  const stepFieldOfView = useCallback(
    (direction: -1 | 1, { shift }: { shift: boolean }) => {
      setFieldOfView(fieldOfView + direction * (shift ? shiftVerticalFieldOfViewStep : 1));
    },
    [fieldOfView, setFieldOfView],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SliderRowTrigger>
          <DropdownMenuSliderItem
            value={fieldOfView}
            min={0}
            max={maxVerticalFieldOfView}
            step={1}
            trailingAdornment='°'
            aria-label={settings.fieldOfViewAria}
            onValueChange={setFieldOfView}
            onStep={stepFieldOfView}
          >
            <Aperture />
            {fieldOfView === 0 ? settings.orthographic : settings.fieldOfView}
          </DropdownMenuSliderItem>
        </SliderRowTrigger>
      </TooltipTrigger>
      <TooltipContent side='right' sideOffset={12}>
        {settings.fieldOfViewDrag}
        <br />
        <span className='text-xs opacity-70'>{settings.fieldOfViewKeys}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Component that provides camera and visibility settings for the 3D viewer.
 * All settings are per-view, read from the per-view GraphicsMachine state via GraphicsProvider;
 * the embedder supplies the CAD operation timeout.
 * @public
 */
export function ViewerSettings({
  className,
  side = 'right',
  align = 'end',
  kernelSettings,
  operationTimeout,
}: ViewerSettingsProps): React.ReactNode {
  const graphicsRef = useGraphics();
  const { viewerSettings, settings } = useViewerLabels();
  const timeoutOptions = useMemo(() => timeoutOptionsOf(settings), [settings]);

  const [isOpen, setIsOpen] = useState(false);
  // A press outside leaves focus with the pointer; a keyboard close returns it to the trigger.
  const isClosingFromPointerRef = useRef(false);

  // Read all settings from per-view graphicsMachine state via context
  const enableSurfaces = useGraphicsSelector((state) => state.context.enableSurfaces);
  const enableLines = useGraphicsSelector((state) => state.context.enableLines);
  const enableGizmo = useGraphicsSelector((state) => state.context.enableGizmo);
  const enableGrid = useGraphicsSelector((state) => state.context.enableGrid);
  const enableAxes = useGraphicsSelector((state) => state.context.enableAxes);
  const enableMatcap = useGraphicsSelector((state) => state.context.enableMatcap);
  const enablePostProcessing = useGraphicsSelector((state) => state.context.enablePostProcessing);
  const upDirection = useGraphicsSelector((state) => state.context.upDirection);
  const is2dGeometry = useGraphicsSelector((state) => state.context.artifact?.mimeType === 'image/svg+xml');

  const handleMeshToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setSurfaceVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleLinesToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setLinesVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleGizmoToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setGizmoVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleGridToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setGridVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleAxesHelperToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setAxesVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleMatcapToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setMatcapVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handlePostProcessingToggle = useCallback(
    (checked: boolean) => {
      graphicsRef.send({ type: 'setPostProcessingVisibility', payload: checked });
    },
    [graphicsRef],
  );

  const handleUpDirectionChange = useCallback(
    (value: UpDirection) => {
      graphicsRef.send({ type: 'setUpDirection', payload: value });
    },
    [graphicsRef],
  );

  const onOperationTimeoutChange = operationTimeout?.onChange;
  const handleOperationTimeoutChange = useCallback(
    (value: string) => {
      onOperationTimeoutChange?.(Number(value));
    },
    [onOperationTimeoutChange],
  );

  const operationTimeoutValue = operationTimeout?.value;
  const operationTimeoutDefault = operationTimeout?.defaultValue;
  const currentTimeoutOption = useMemo(
    () =>
      timeoutOptions.find((option) => option.value === operationTimeoutValue) ??
      timeoutOptions.find((option) => option.value === operationTimeoutDefault) ??
      timeoutOptions[0]!,
    [operationTimeoutDefault, operationTimeoutValue, timeoutOptions],
  );

  const getTimeoutValue = useCallback((option: TimeoutOption): string => String(option.value), []);
  const getTimeoutLabel = useCallback((option: TimeoutOption): string => option.label, []);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant='overlay' size='icon' aria-label={viewerSettings} className={cn(className)}>
              <Settings />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{viewerSettings}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        side={side}
        className='w-72'
        onEscapeKeyDown={preventMenuSliderEscapeDismissal}
        onPointerDownOutside={() => {
          isClosingFromPointerRef.current = true;
        }}
        onCloseAutoFocus={(event) => {
          if (isClosingFromPointerRef.current) {
            event.preventDefault();
          }
          isClosingFromPointerRef.current = false;
        }}
      >
        {!is2dGeometry && (
          <>
            <DropdownMenuLabel>{settings.model}</DropdownMenuLabel>
            <DropdownMenuSwitchItem isChecked={enableSurfaces} onIsCheckedChange={handleMeshToggle}>
              <Box />
              {settings.surfaces}
            </DropdownMenuSwitchItem>
            <DropdownMenuSwitchItem isChecked={enableLines} onIsCheckedChange={handleLinesToggle}>
              <PenLine />
              {settings.lines}
            </DropdownMenuSwitchItem>
            <DropdownMenuSwitchItem
              icon={<Sparkles />}
              description={enableMatcap ? settings.lightingInactive : settings.lightingActive}
              isChecked={enableMatcap}
              onIsCheckedChange={handleMatcapToggle}
            >
              {settings.matcap} <InfoTooltip>{settings.matcapInfo}</InfoTooltip>
            </DropdownMenuSwitchItem>
            <DropdownMenuSwitchItem
              icon={<Layers />}
              description={enablePostProcessing ? settings.occlusionActive : settings.occlusionInactive}
              isChecked={enablePostProcessing}
              onIsCheckedChange={handlePostProcessingToggle}
            >
              {settings.postProcessing} <InfoTooltip>{settings.postProcessingInfo}</InfoTooltip>
            </DropdownMenuSwitchItem>
            <ModelMaterialMenuRows />
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{settings.viewport}</DropdownMenuLabel>
        <DropdownMenuSwitchItem
          className={cn(is2dGeometry && 'hidden')}
          isChecked={enableGizmo}
          onIsCheckedChange={handleGizmoToggle}
        >
          <Rotate3D />
          {settings.gizmo}
        </DropdownMenuSwitchItem>
        <DropdownMenuSwitchItem isChecked={enableGrid} onIsCheckedChange={handleGridToggle}>
          <Grid3X3 />
          {settings.grid}
        </DropdownMenuSwitchItem>
        <DropdownMenuSwitchItem isChecked={enableAxes} onIsCheckedChange={handleAxesHelperToggle}>
          <Axis3D />
          {settings.axes}
        </DropdownMenuSwitchItem>
        {!is2dGeometry && (
          <>
            <DropdownMenuToggleGroupItem
              value={upDirection}
              options={upDirectionOptions.map((option) => ({
                ...option,
                ariaLabel: settings.upAria(option.value.toUpperCase()),
              }))}
              onValueChange={handleUpDirectionChange}
            >
              <ArrowUp />
              {settings.upDirection}
            </DropdownMenuToggleGroupItem>
            <FieldOfViewRow />
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{settings.rendering}</DropdownMenuLabel>
        {operationTimeout ? (
          <DropdownMenuSelectItem
            value={currentTimeoutOption}
            options={timeoutOptions}
            getOptionValue={getTimeoutValue}
            getOptionLabel={getTimeoutLabel}
            infoTooltip={<InfoTooltip>{settings.timeoutInfo}</InfoTooltip>}
            onValueChange={handleOperationTimeoutChange}
          >
            <Timer />
            {settings.renderTimeout}
          </DropdownMenuSelectItem>
        ) : undefined}
        {kernelSettings}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
