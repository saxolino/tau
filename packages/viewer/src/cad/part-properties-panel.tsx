import { useCallback, useMemo, useState } from 'react';
import { PaneVirtualList } from '@taucad/ui/components/pane-virtual-list';
import { Box, ChevronDown, CircleAlert, CircleHelp, LoaderCircle } from 'lucide-react';
import type { GeometryComponentKind, GeometryComponentNode } from '@taucad/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@taucad/ui/components/collapsible';
import { cn } from '@taucad/ui/utils/cn';
import { PanelEmptyState } from '@taucad/ui/components/panel-empty-state';
import { MaterialSwatch } from '#cad/material-swatch.jsx';
import { appearanceLabel, englishPartQuantityWords, statusOf, volumeLabel, weightLabel } from '#cad/part-quantities.js';
import type { PartQuantity, PartQuantityWords } from '#cad/part-quantities.js';
import { DetailsToggle, disclosureMotion } from '@taucad/ui/components/actions';
import { PartPreviewFrame } from '#cad/part-preview-image.jsx';
import type { PartThumbnailState } from '#cad/part-thumbnail-state.js';

/**
 * Every word the Properties panel shows, with the quantity words and number locale, in the host's language.
 *
 * @public
 */
export type PartPropertiesLabels = PartQuantityWords &
  Readonly<{
    noPartSelected: string;
    /** The part's kind under its name: `part`, `assembly`… */
    kind: (kind: GeometryComponentKind) => string;
    /** Where the part is from when neither an entry title nor an entry path is given. */
    currentModel: string;
    /** The identity frame's accessible name. */
    preview: (name: string) => string;
    previewStatus: string;
    previewLoading: string;
    previewUnavailable: string;
    retryPreview: string;
    appearance: string;
    appearanceMaterials: string;
    /** The mark beside a material that carries extensions. */
    extensionsMark: string;
    baseColor: string;
    texture: string;
    metalness: string;
    roughness: string;
    extensions: string;
    source: string;
    /** A material value the source leaves to the format's default. */
    sourceDefault: string;
    none: string;
    noneSpecified: string;
    textureIndex: (slot: string, index: number) => string;
    textureReference: (slot: string) => string;
    defaultMaterial: string;
    /** The source material a finish comes from, counted from 1. */
    sourceMaterial: (position: number) => string;
    physicalFacts: string;
    material: string;
    notSpecified: string;
    density: string;
    volume: string;
    weight: string;
    measurementStatus: string;
    details: string;
    volumeMethod: string;
    densitySource: string;
    densitySourceValue: string;
    basis: string;
    basisValue: string;
    scope: string;
    partScope: string;
    groupScope: string;
    excludes: string;
    excludesValue: string;
  }>;

/**
 * The English words the Properties panel uses unless a host passes its own.
 *
 * @public
 */
export const englishPartPropertiesLabels: PartPropertiesLabels = {
  ...englishPartQuantityWords,
  noPartSelected: 'No part selected',
  kind: (kind) => kind,
  currentModel: 'Current model',
  preview: (name) => `Preview ${name}`,
  previewStatus: 'Preview status',
  previewLoading: 'Preview loading',
  previewUnavailable: 'Preview unavailable',
  retryPreview: 'Retry preview',
  appearance: 'Appearance',
  appearanceMaterials: 'Appearance materials',
  extensionsMark: '· extensions',
  baseColor: 'Base color',
  texture: 'Texture',
  metalness: 'Metalness',
  roughness: 'Roughness',
  extensions: 'Extensions',
  source: 'Source',
  sourceDefault: 'glTF default',
  none: 'None',
  noneSpecified: 'None specified',
  textureIndex: (slot, index) => `${slot}: source texture index ${index}`,
  textureReference: (slot) => `${slot}: source reference`,
  defaultMaterial: 'Default glTF material',
  sourceMaterial: (position) => `Material ${position} of the source file; before selection and opacity overrides`,
  physicalFacts: 'Physical facts',
  material: 'Material',
  notSpecified: 'Not specified',
  density: 'Density',
  volume: 'Volume',
  weight: 'Weight',
  measurementStatus: 'Measurement status',
  details: 'Details',
  volumeMethod: 'Volume method',
  densitySource: 'Density source',
  densitySourceValue: 'Not supplied; a finish is not a material',
  basis: 'Basis',
  basisValue: 'Source geometry; physical basis unverified',
  scope: 'Scope',
  partScope: 'Selected part; physical scope unverified',
  groupScope: 'Selected group; physical scope unverified',
  excludes: 'Excludes',
  excludesValue: 'Coatings, hardware, tolerances',
};

type PartPropertiesPanelProps = {
  readonly node?: GeometryComponentNode;
  /** The part's name as the host shows it. Absent, the node's name. */
  readonly name?: string;
  readonly entryPath?: string;
  /** The entry's name as the host shows it, for a host that keeps file names out of sight. Absent, the entry path. */
  readonly entryTitle?: string;
  readonly quantity?: PartQuantity;
  readonly preview?: PartThumbnailState;
  readonly onRetryPreview?: () => void;
  readonly onPreviewDecodeError?: () => void;
  readonly onPreviewDecoded?: () => void;
  /** Opens the part gallery from the identity frame. */
  readonly onOpenPreview?: (origin: HTMLElement) => void;
  /** Hide the identity row where a surrounding header already names the part. */
  readonly isIdentityHidden?: boolean;
  /** The panel's words in the host's language. Absent, English. */
  readonly labels?: PartPropertiesLabels;
};

function Fact({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 text-right wrap-break-word @max-[14rem]/properties:mb-2 @max-[14rem]/properties:text-left'>
        {value}
      </dd>
    </>
  );
}

function textureLabel(
  textures: NonNullable<NonNullable<GeometryComponentNode['appearance']>['materials']>[number]['textures'],
  labels: PartPropertiesLabels,
): string {
  if (!textures) {
    return labels.noneSpecified;
  }
  return (
    Object.entries(textures)
      .map(([slot, reference]) => {
        const { index } = reference;
        return typeof index === 'number' ? labels.textureIndex(slot, index) : labels.textureReference(slot);
      })
      .join(', ') || labels.noneSpecified
  );
}

/**
 * A material factor or color as the source states it: the format's default, unavailable, or the value.
 *
 * @param value - The factor or color, if the source gives one.
 * @param labels - The words and locale to write in.
 * @returns What the panel shows for it.
 */
function materialValueLabel(value: number | string | undefined, labels: PartPropertiesLabels): string {
  if (value === undefined) {
    return labels.sourceDefault;
  }
  if (value === 'unavailable') {
    return labels.unavailable;
  }
  return typeof value === 'number' ? new Intl.NumberFormat(labels.locale).format(value) : value;
}

/**
 * The part's preview frame, its name, and its kind and entry.
 *
 * @returns The identity row.
 */
function PartIdentity({
  node,
  name = node.name,
  entryPath,
  entryTitle,
  preview,
  labels,
  onOpenPreview,
  onPreviewDecodeError,
  onPreviewDecoded,
}: Pick<
  PartPropertiesPanelProps,
  'name' | 'entryPath' | 'entryTitle' | 'preview' | 'onOpenPreview' | 'onPreviewDecodeError' | 'onPreviewDecoded'
> & {
  readonly node: GeometryComponentNode;
  readonly labels: PartPropertiesLabels;
}): React.JSX.Element {
  const materials = node.appearance?.materials ?? [];
  return (
    <div className='flex items-center gap-3'>
      <PartPreviewFrame
        name={name}
        label={labels.preview(name)}
        preview={preview}
        className='size-20'
        fallback={
          materials.length > 0 ? (
            <MaterialSwatch materials={materials} />
          ) : (
            <Box aria-hidden='true' className='size-4' />
          )
        }
        onOpen={onOpenPreview}
        onDecodeError={onPreviewDecodeError}
        onDecoded={onPreviewDecoded}
      />
      <div className='min-w-0'>
        <div className='line-clamp-2 font-medium wrap-break-word'>{name}</div>
        <div className='truncate text-xs text-muted-foreground'>
          {labels.kind(node.kind)} · {entryTitle ?? entryPath ?? labels.currentModel}
        </div>
      </div>
    </div>
  );
}

/**
 * The Properties panel for a selected part: its preview, appearance, physical facts and measurement status, or an empty state when no part is selected.
 *
 * @param props - The part node, its name and entry, quantities, preview, preview handlers and words.
 * @returns The panel.
 * @public
 */
export function PartPropertiesPanel({
  node,
  name,
  entryPath,
  entryTitle,
  quantity = {},
  preview,
  onRetryPreview,
  onPreviewDecodeError,
  onPreviewDecoded,
  onOpenPreview,
  isIdentityHidden = false,
  labels = englishPartPropertiesLabels,
}: PartPropertiesPanelProps): React.JSX.Element {
  if (!node) {
    return <PanelEmptyState icon={Box} title={labels.noPartSelected} className='min-h-40' />;
  }

  const materials = node.appearance?.materials ?? [];
  const status = statusOf(quantity, labels);
  return (
    <div data-slot='part-properties' className='@container/properties space-y-3 p-3 text-sm'>
      {isIdentityHidden ? undefined : (
        <PartIdentity
          node={node}
          name={name}
          entryPath={entryPath}
          entryTitle={entryTitle}
          preview={preview}
          labels={labels}
          onOpenPreview={onOpenPreview}
          onPreviewDecodeError={onPreviewDecodeError}
          onPreviewDecoded={onPreviewDecoded}
        />
      )}

      {preview?.status === 'pending' || preview?.status === 'failed' ? (
        <div
          role={preview.status === 'failed' ? 'alert' : 'status'}
          aria-label={labels.previewStatus}
          aria-busy={preview.status === 'pending' || undefined}
          className='flex items-center justify-between gap-2 text-xs text-muted-foreground'
        >
          <span className='flex items-center gap-1.5'>
            {preview.status === 'pending' ? (
              <LoaderCircle aria-hidden='true' className='size-3.5 spin-glyph' />
            ) : (
              <CircleAlert aria-hidden='true' className='size-3.5' />
            )}
            {preview.status === 'pending' ? labels.previewLoading : labels.previewUnavailable}
          </span>
          {preview.status === 'failed' && onRetryPreview ? (
            <button type='button' className='rounded-sm underline focus-visible:focus-outline' onClick={onRetryPreview}>
              {labels.retryPreview}
            </button>
          ) : undefined}
        </div>
      ) : undefined}

      <section aria-label={labels.appearance}>
        <h3 className='mb-1 text-xs font-medium text-muted-foreground'>{labels.appearance}</h3>
        {materials.length > 0 ? (
          <AppearanceMaterials key={node.id} materials={materials} labels={labels} />
        ) : (
          <p className='text-xs text-muted-foreground'>{appearanceLabel(node, labels)}</p>
        )}
      </section>

      <section aria-label={labels.physicalFacts}>
        <h3 className='mb-1 text-xs font-medium text-muted-foreground'>{labels.physicalFacts}</h3>
        <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs @max-[14rem]/properties:grid-cols-1'>
          <Fact label={labels.material} value={labels.notSpecified} />
          <Fact label={labels.density} value={labels.unknown} />
          <Fact label={labels.volume} value={volumeLabel(quantity, labels)} />
          <Fact label={labels.weight} value={weightLabel(quantity, labels)} />
        </dl>
      </section>

      <Collapsible>
        <div className='flex min-w-0 items-center justify-between gap-2'>
          <p
            role={status.kind === 'failed' ? 'alert' : 'status'}
            aria-label={labels.measurementStatus}
            className={cn('min-w-0 truncate text-xs text-muted-foreground', status.kind === 'failed' && 'text-feature')}
          >
            <CircleHelp aria-hidden='true' className='mr-1 inline size-3.5' />
            {status.sentence}
          </p>
          <DetailsToggle label={labels.details} />
        </div>
        <CollapsibleContent className={disclosureMotion}>
          <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 pt-2 text-xs @max-[14rem]/properties:grid-cols-1'>
            <Fact label={labels.volumeMethod} value={labels.notMeasured} />
            <Fact label={labels.densitySource} value={labels.densitySourceValue} />
            <Fact label={labels.basis} value={labels.basisValue} />
            <Fact label={labels.scope} value={node.kind === 'part' ? labels.partScope : labels.groupScope} />
            <Fact label={labels.excludes} value={labels.excludesValue} />
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type AppearanceMaterial = NonNullable<NonNullable<GeometryComponentNode['appearance']>['materials']>[number];
type AppearanceRow = { readonly material: AppearanceMaterial; readonly key: string };
const appearanceKey = (row: AppearanceRow): string => row.key;

function AppearanceMaterials({
  materials,
  labels,
}: {
  readonly materials: readonly AppearanceMaterial[];
  readonly labels: PartPropertiesLabels;
}): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const data = useMemo(
    () =>
      materials.map((material, ordinal) => ({ material, key: `${material.materialIndex ?? 'default'}-${ordinal}` })),
    [materials],
  );
  const renderMaterial = useCallback(
    (_index: number, { material, key }: AppearanceRow) => (
      <Collapsible
        open={open.has(key)}
        onOpenChange={(isOpen) => {
          setOpen((current) => {
            const next = new Set(current);
            if (isOpen) {
              next.add(key);
            } else {
              next.delete(key);
            }
            return next;
          });
        }}
      >
        <CollapsibleTrigger className='flex min-h-7 w-full items-center gap-2 rounded-sm text-left focus-visible:focus-outline'>
          <MaterialSwatch materials={[material]} />
          <span className='min-w-0 flex-1 truncate'>
            {typeof material.name === 'string' && material.name.trim() ? material.name : labels.unnamedMaterial}
          </span>
          {material.extensions && Object.keys(material.extensions).length > 0 ? (
            <span className='truncate text-xs text-muted-foreground'>{labels.extensionsMark}</span>
          ) : undefined}
          <ChevronDown aria-hidden='true' className='size-3.5 shrink-0 text-muted-foreground' />
        </CollapsibleTrigger>
        <CollapsibleContent className={disclosureMotion}>
          <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 py-2 pl-6 text-xs @max-[14rem]/properties:grid-cols-1 @max-[14rem]/properties:pl-0'>
            <Fact label={labels.baseColor} value={materialValueLabel(material.color, labels)} />
            <Fact label={labels.texture} value={textureLabel(material.textures, labels)} />
            <Fact label={labels.metalness} value={materialValueLabel(material.metalness, labels)} />
            <Fact label={labels.roughness} value={materialValueLabel(material.roughness, labels)} />
            <Fact
              label={labels.extensions}
              value={material.extensions ? Object.keys(material.extensions).join(', ') || labels.none : labels.none}
            />
            <Fact
              label={labels.source}
              value={
                material.materialIndex === undefined
                  ? labels.defaultMaterial
                  : labels.sourceMaterial(material.materialIndex + 1)
              }
            />
          </dl>
        </CollapsibleContent>
      </Collapsible>
    ),
    [labels, open],
  );
  return (
    <PaneVirtualList
      data={data}
      getItemKey={appearanceKey}
      itemContent={renderMaterial}
      ariaLabel={labels.appearanceMaterials}
    />
  );
}
