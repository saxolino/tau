import { Input } from '@taucad/ui/components/input';
import { Button } from '@taucad/ui/components/button';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { Switch } from '@taucad/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@taucad/ui/components/toggle-group';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { ManualSketchControls } from '#hooks/use-manual-sketch-tool.js';
import { ManualChoice, ManualNumberField } from '#routes/w.$workspace.$project/manual-edit-fields.js';

/**
 * The inspector while a sketch is open: the plane, whether the drawing closes a profile, what the profile becomes
 * (extrude with an optional draft, revolve about a sketch line or a model edge, sweep along a drawn path or an edge),
 * whether it joins the piece, removes from it or makes a new one, and one Applica (Invio) and one Annulla (Esc). The
 * numbers here and the ghost on the model are the same draft.
 */
export function ManualSketchSection({ controls }: Readonly<{ controls: ManualSketchControls }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const { draft, plane, stage } = controls;
  const area = (value: number): string =>
    formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const problem = controls.problem
    ? controls.problem === 'invalid'
      ? t('sketch.errors.invalid', { detail: controls.problemDetail ?? '' })
      : controls.problem === 'axisOffPlane'
        ? t('sketch.axisOffPlane')
        : controls.problem === 'pathInvalid'
          ? t('sketch.pathInvalid')
          : t(`sketch.errors.${controls.problem}`)
    : undefined;
  const loop = controls.loops[controls.loopIndex];
  return (
    <section aria-label={t('sketch.title')} className='flex min-w-0 flex-col'>
      <div className='min-w-0 space-y-4 px-4 py-3'>
        <div className='flex items-baseline justify-between gap-2'>
          <h3 className='min-w-0 truncate text-sm font-medium'>
            {controls.isPath
              ? t('sketch.drawingPath')
              : plane
                ? `${t('sketch.title')} · ${plane.label}`
                : t('sketch.title')}
          </h3>
          <Eyebrow>{t('manualEdit.draft')}</Eyebrow>
        </div>
        {stage === 'plane' ? (
          <div className='space-y-2'>
            <p className='text-xs leading-relaxed text-muted-foreground'>{t('sketch.choosePlane')}</p>
            <div role='group' aria-label={t('sketch.basePlanes')} className='flex gap-1'>
              {(['xy', 'xz', 'yz'] as const).map((name) => (
                <Button
                  key={name}
                  size='sm'
                  variant='outline'
                  className='flex-1 font-mono'
                  onClick={() => {
                    controls.onBasePlane(name);
                  }}
                >
                  {name.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {controls.editing ? <p className='text-xs text-muted-foreground'>{t('sketch.editing')}</p> : null}
        {stage !== 'plane' && !controls.isPath && draft ? (
          <>
            <div className='space-y-1'>
              <Eyebrow>{t('sketch.profile.choose')}</Eyebrow>
              <p role='status' className='text-xs text-muted-foreground'>
                {loop
                  ? t('sketch.profile.closed', { area: area(loop.area) })
                  : (controls.drawing?.entities.length ?? 0) > 0
                    ? t('sketch.profile.open')
                    : t('sketch.profile.empty')}
              </p>
              {controls.loops.length > 1 ? (
                <ManualChoice
                  label={t('sketch.profile.choose')}
                  value={String(controls.loopIndex)}
                  choices={controls.loops.map((_, index) => ({
                    value: String(index),
                    label: t('sketch.profile.item', { number: index + 1 }),
                  }))}
                  onChange={(value) => {
                    controls.onLoop(Number(value));
                  }}
                />
              ) : null}
            </div>
            <div className='space-y-2'>
              <Eyebrow>{t('sketch.operation')}</Eyebrow>
              <ToggleGroup
                type='single'
                value={draft.kind}
                aria-label={t('sketch.operation')}
                variant='outline'
                size='sm'
                className='w-full'
                onValueChange={(kind) => {
                  if (kind === 'extrude' || kind === 'revolve' || kind === 'sweep') {
                    controls.onDraft({ kind });
                  }
                }}
              >
                {(['extrude', 'revolve', 'sweep'] as const).map((kind) => (
                  <ToggleGroupItem
                    key={kind}
                    value={kind}
                    className='flex-1 data-[state=on]:border-titanium data-[state=on]:bg-titanium/15'
                  >
                    {t(`sketch.operations.${kind}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className='space-y-2'>
              <ManualChoice
                label={t('sketch.result')}
                value={draft.mode}
                choices={[
                  ...(controls.targets.length > 0
                    ? [
                        { value: 'add', label: t('sketch.modes.add') },
                        { value: 'cut', label: t('sketch.modes.cut') },
                      ]
                    : []),
                  { value: 'new', label: t('sketch.modes.new') },
                ]}
                onChange={(mode) => {
                  if (mode === 'add' || mode === 'cut' || mode === 'new') {
                    controls.onDraft({ mode });
                  }
                }}
              />
              {draft.mode === 'new' ? (
                <label className='grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2 text-sm text-muted-foreground'>
                  {t('sketch.name')}
                  <Input
                    value={controls.name}
                    onChange={(event) => {
                      controls.onName(event.target.value);
                    }}
                  />
                </label>
              ) : (
                <ManualChoice
                  label={t('sketch.piece')}
                  value={controls.target ?? ''}
                  choices={controls.targets.map((name) => ({ value: name, label: name }))}
                  onChange={controls.onTarget}
                />
              )}
            </div>
            {draft.kind === 'extrude' ? (
              <div className='space-y-2'>
                <ManualNumberField
                  label={t('sketch.distance')}
                  value={draft.distance}
                  min={0.01}
                  onChange={(distance) => {
                    controls.onDraft({ distance: Math.abs(distance) });
                  }}
                />
                <label className='flex items-center justify-between gap-2 text-sm text-muted-foreground'>
                  {t('sketch.reverse')}
                  <Switch
                    checked={draft.reverse}
                    onCheckedChange={(reverse) => {
                      controls.onDraft({ reverse });
                    }}
                  />
                </label>
                <ManualNumberField
                  label={t('sketch.taper')}
                  value={draft.taper}
                  unit='°'
                  step={0.5}
                  min={-60}
                  max={60}
                  onChange={(taper) => {
                    controls.onDraft({ taper: Math.max(-60, Math.min(60, taper)) });
                  }}
                />
                <p className='text-xs text-muted-foreground'>{t('sketch.taperHelp')}</p>
              </div>
            ) : null}
            {draft.kind === 'revolve' ? (
              <div className='space-y-2'>
                <ManualNumberField
                  label={t('sketch.angle')}
                  value={draft.angle}
                  unit='°'
                  step={1}
                  min={-360}
                  max={360}
                  onChange={(angle) => {
                    controls.onDraft({ angle: Math.max(-360, Math.min(360, angle)) || 360 });
                  }}
                />
                <div className='space-y-1.5'>
                  <span className='text-sm text-muted-foreground'>{t('sketch.axis')}</span>
                  <div className='grid min-w-0 grid-cols-2 gap-1'>
                    <Button
                      size='xs'
                      variant='outline'
                      className='min-w-0 aria-pressed:border-titanium aria-pressed:bg-titanium/15'
                      aria-pressed={draft.axis?.source === 'line'}
                      disabled={controls.axisLineCount === 0}
                      onClick={controls.onAxisLine}
                    >
                      <span className='truncate'>{t('sketch.axisLine')}</span>
                    </Button>
                    <Button
                      size='xs'
                      variant='outline'
                      className='min-w-0 aria-pressed:border-titanium aria-pressed:bg-titanium/15'
                      aria-pressed={draft.axis?.source === 'edge' || stage === 'pickEdge'}
                      onClick={() => {
                        controls.onPickEdge('axis');
                      }}
                    >
                      <span className='truncate'>{t('sketch.pickAxis')}</span>
                    </Button>
                  </div>
                </div>
                {draft.axis ? null : <p className='text-xs text-muted-foreground'>{t('sketch.axisNone')}</p>}
              </div>
            ) : null}
            {draft.kind === 'sweep' ? (
              <div className='space-y-2'>
                <div className='space-y-1.5'>
                  <span className='text-sm text-muted-foreground'>{t('sketch.path')}</span>
                  <div className='grid min-w-0 grid-cols-2 gap-1'>
                    <Button
                      size='xs'
                      variant='outline'
                      className='min-w-0 aria-pressed:border-titanium aria-pressed:bg-titanium/15'
                      aria-pressed={draft.path?.kind === 'sketch'}
                      disabled={!loop}
                      onClick={controls.onDrawPath}
                    >
                      <span className='truncate'>{t('sketch.drawPath')}</span>
                    </Button>
                    <Button
                      size='xs'
                      variant='outline'
                      className='min-w-0 aria-pressed:border-titanium aria-pressed:bg-titanium/15'
                      aria-pressed={draft.path?.kind === 'edge' || stage === 'pickEdge'}
                      onClick={() => {
                        controls.onPickEdge('path');
                      }}
                    >
                      <span className='truncate'>{t('sketch.pickPath')}</span>
                    </Button>
                  </div>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {draft.path?.kind === 'sketch'
                    ? t(controls.pathSegmentCount === 1 ? 'sketch.pathSketchOne' : 'sketch.pathSketch', {
                        count: controls.pathSegmentCount ?? 0,
                      })
                    : draft.path?.kind === 'edge'
                      ? t('sketch.pathEdge', { piece: draft.path.piece })
                      : t('sketch.pathNone')}
                </p>
              </div>
            ) : null}
            <p className='text-xs text-muted-foreground'>{t('sketch.sculptNote')}</p>
          </>
        ) : null}
        {controls.isPath ? <p className='text-xs text-muted-foreground'>{t('sketch.pathNone')}</p> : null}
        {problem ? (
          <p role='alert' className='text-sm text-destructive'>
            {problem}
          </p>
        ) : null}
      </div>
      <div className='sticky bottom-0 z-10 flex items-center justify-end gap-1.5 border-t border-border bg-sidebar px-4 py-2'>
        <Button size='sm' variant='ghost' disabled={controls.busy} aria-keyshortcuts='Escape' onClick={controls.onExit}>
          {t('sketch.cancel')}
          <KeyShortcut variant='ghost'>Esc</KeyShortcut>
        </Button>
        {controls.isPath ? (
          <Button size='sm' onClick={controls.onPathDone}>
            {t('sketch.pathDone')}
          </Button>
        ) : (
          <Button
            size='sm'
            disabled={!controls.canApply}
            aria-busy={controls.busy}
            aria-keyshortcuts='Enter'
            onClick={controls.onApply}
          >
            {controls.busy ? t('manualEdit.saving') : t('sketch.apply')}
            <KeyShortcut variant='tooltip'>↵</KeyShortcut>
          </Button>
        )}
      </div>
    </section>
  );
}
