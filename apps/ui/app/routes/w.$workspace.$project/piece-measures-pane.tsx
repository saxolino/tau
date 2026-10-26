import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { ChevronDown, ChevronRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { getActiveGroupValues } from '@taucad/types';
import type { ParameterManifest } from '@taucad/parameters';
import type { ParametersSource } from '@taucad/workbench-panes/parameters/parameters-source';
import { Parameters } from '@taucad/viewer/parameters/parameters';
import type { ParameterCommit, ParameterEdit, ParameterPresentation } from '@taucad/viewer/parameters/rjsf-context';
import {
  createSourceModelInteractionUnitId,
  getModelInteractionUnitState,
} from '@taucad/viewer/machines/model-interaction.machine';
import { Button } from '@taucad/ui/components/button';
import { SearchInput } from '@taucad/ui/components/search-input';
import { cn } from '@taucad/ui/utils/cn';
import { useProject } from '#hooks/use-project.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { languageLocales } from '#i18n/language.js';
import {
  flatMeasurePiece,
  groupPieceMeasures,
  modelMeasureSummary,
  modelPieces,
  parameterAssumption,
  pieceKeyValue,
  pieceParameterSchema,
  readablePieceName,
  valueAtPath,
} from '#lib/piece-measures.js';
import type { PieceMeasureGroup } from '#lib/piece-measures.js';
import { modelWeight } from '#lib/piece-weight.js';
import { PieceMaterialRow } from '#routes/w.$workspace.$project/piece-material-row.js';

const units = { length: { displaySymbol: 'mm' } } as const;

/** Counts all physical pieces, including hidden ones; unavailable mass is omitted. */
export function ModelSummaryRow(): React.JSX.Element {
  const { modelInteractionRef } = useProject();
  const context = useSelector(modelInteractionRef, (state) => state.context);
  const { t, language } = useTranslation();
  const pieces = context.unitOrder.flatMap((id) => modelPieces(context.unitsById[id]?.manifest));
  const summary = modelMeasureSummary(pieces);
  const materials = Object.fromEntries(
    context.unitOrder.flatMap((id) => Object.entries(context.unitsById[id]?.materialByComponentId ?? {})),
  );
  const weight = modelWeight(pieces, materials);
  const mass = (grams: number): string => formatNumber(grams, language, { maximumFractionDigits: 2 });
  return (
    <p className='px-3 py-3 text-xs text-muted-foreground tabular-nums'>
      {t('measures.counts', {
        pieces: t(summary.pieces === 1 ? 'measures.onePiece' : 'measures.manyPieces', { count: summary.pieces }),
        stones: t(summary.stones === 1 ? 'measures.oneStone' : 'measures.manyStones', { count: summary.stones }),
      })}
      {weight?.material
        ? ` · ${t('materials.weightOf', { material: t(`materials.names.${weight.material}`), mass: mass(weight.grams) })}`
        : summary.goldMass === undefined
          ? weight
            ? ` · ${t('materials.weight', { mass: mass(weight.grams) })}`
            : null
          : ` · ${t('measures.goldMass', { mass: mass(summary.goldMass) })}`}
    </p>
  );
}

const PieceGroup = memo(function PieceGroup({
  group,
  source,
  entryPath,
  manifest,
  filterTerm,
}: {
  readonly group: PieceMeasureGroup;
  readonly source: ParametersSource;
  readonly entryPath: string;
  readonly manifest: ParameterManifest | undefined;
  readonly filterTerm: string;
}): React.JSX.Element | undefined {
  const { modelInteractionRef } = useProject();
  const unitId = createSourceModelInteractionUnitId(entryPath);
  const unit = useSelector(modelInteractionRef, (state) => getModelInteractionUnitState(state.context, unitId));
  const { entry } = source.useEntry(entryPath);
  const { t, language } = useTranslation();
  const [isGeneralOpen, setIsGeneralOpen] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const selected = unit.selectedComponentIds.at(-1);
  const isSelected = selected === group.node?.id && selected !== undefined;
  const isOpen = group.node ? isSelected : isGeneralOpen;
  const isHidden = group.node !== undefined && unit.hiddenComponentIds.includes(group.node.id);
  const name = group.node ? readablePieceName(group.node.name, language) : t('measures.general');
  const defaults = manifest?.defaults ?? {};
  const values = useMemo(() => getActiveGroupValues(entry), [entry]);
  const schema = manifest?.legacyProjection.status === 'usable' ? manifest.legacyProjection.schema : undefined;
  const groupSchema = useMemo(() => pieceParameterSchema(schema, group.keys), [schema, group.keys]);
  const activeGroup = entry?.activeGroup;
  const scrub = source.useScrub?.(entryPath);
  const edit = useMemo<ParameterEdit | undefined>(() => {
    if (!manifest || !activeGroup || !source.drafts) {
      return undefined;
    }
    const { drafts } = source;
    const commit: ParameterCommit['commit'] = async (field) =>
      source.commitValue(entryPath, manifest, { ...field, group: activeGroup });
    return {
      kind: 'authoritative',
      commit: {
        target: source.target?.(entryPath) ?? { authority: 'workbench-panes', root: '', entry: entryPath },
        group: activeGroup,
        draft: (pointer) => drafts.draft({ entryPath, group: activeGroup, pointer }),
        setDraft: (pointer, draft) => {
          drafts.setDraft({ entryPath, group: activeGroup, pointer }, draft);
        },
        subscribeDrafts: drafts.subscribe,
        commit,
        setValue: async (field) => {
          const outcome = await commit(field);
          if (outcome?.status !== 'committed') {
            throw new Error(t('measures.failure'));
          }
        },
        ...scrub,
      },
    };
  }, [manifest, activeGroup, source, entryPath, scrub, t]);
  const presentationOptions = useMemo<ParameterPresentation>(
    () => ({
      locale: languageLocales[language],
      embedFirstLevel: true,
      hideRequiredMark: true,
      inferredHint: (kind) => t(kind === 'unit' ? 'measures.inferredUnit' : 'measures.inferredSemantics'),
      resetLabel: (name) => t('measures.reset', { name }),
      fieldDescription: (_path, description) => (description.startsWith('[sinopia:assumed]') ? '' : description),
      // A flat measure inside its piece drops the piece's name: «Larghezza» under Marquise, not «Marquise larghezza».
      fieldLabel: (path, fallback) => {
        const key = path.at(-1) ?? fallback;
        const measure = group.node && path.length === 1 ? flatMeasurePiece(key, [group.node])?.measure : undefined;
        return readablePieceName(measure ?? key, language);
      },
      fieldNote: (path) => {
        const locked = valueAtPath(values, path) !== undefined;
        const assumption = parameterAssumption(schema, path);
        return locked ? (
          // A note, not an alarm: small, neutral, the lock in the selection's titanium (UI-UX-SinopiaCAD §3.2).
          <span className='flex items-center gap-1 text-xs leading-4 text-muted-foreground'>
            <LockKeyhole aria-hidden='true' className='size-3 text-accent-foreground' />
            {t('measures.locked')}
          </span>
        ) : assumption === undefined ? null : (
          <span title={assumption || undefined} className='text-xs leading-4 text-muted-foreground'>
            {t('measures.assumed')}
          </span>
        );
      },
    }),
    [group.node, language, schema, t, values],
  );
  const changeParameters = useCallback(
    (next: Record<string, unknown>) => {
      if (!manifest) {
        return;
      }
      // RJSF sees only this piece. Preserve overrides of the other pieces during a reset.
      const retained = Object.fromEntries(Object.entries(values).filter(([key]) => !group.keys.includes(key)));
      const changed = Object.fromEntries(Object.entries(next).filter(([key]) => group.keys.includes(key)));
      const save = async (): Promise<void> => {
        try {
          await source.replaceValues(entryPath, manifest, { ...retained, ...changed });
        } catch {
          source.reportError?.(t('measures.failure'));
        }
      };
      void save();
    },
    [manifest, values, group.keys, source, entryPath, t],
  );
  useEffect(() => {
    if (!isSelected) {
      return;
    }
    const frame = requestAnimationFrame(() => element.current?.scrollIntoView({ block: 'nearest' }));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isSelected]);
  const query = filterTerm.trim().toLocaleLowerCase();
  const nameMatches = name.toLocaleLowerCase().includes(query);
  const fieldsMatch = JSON.stringify(groupSchema?.properties ?? {})
    .toLocaleLowerCase()
    .includes(query);
  if (query && !nameMatches && !fieldsMatch && !isSelected) {
    return undefined;
  }
  return (
    <div
      ref={element}
      className={cn('border-b border-border', isSelected && 'bg-accent/30')}
      data-slot='piece-measures-group'
      data-piece={group.node?.id}
    >
      <div className='flex min-h-11 items-center gap-1 pr-1'>
        <Button
          variant='ghost'
          className='min-h-11 min-w-0 flex-1 justify-start gap-2 rounded-none'
          aria-expanded={isOpen || Boolean(query)}
          aria-pressed={group.node ? isSelected : undefined}
          onClick={() => {
            if (group.node) {
              modelInteractionRef.send({
                type: 'selectComponent',
                unitId,
                componentId: group.node.id,
                source: 'explorer',
              });
            } else {
              setIsGeneralOpen((open) => !open);
            }
          }}
        >
          {isOpen || query ? (
            <ChevronDown aria-hidden='true' className='size-3 shrink-0' />
          ) : (
            <ChevronRight aria-hidden='true' className='size-3 shrink-0' />
          )}
          {group.node ? (
            <span
              aria-hidden='true'
              className='size-2 shrink-0 rounded-full border border-border bg-muted'
              style={{ backgroundColor: group.node.appearance?.color }}
            />
          ) : null}
          <span className='min-w-0 flex-1 truncate text-left text-xs' title={name}>
            {name}
          </span>
          <span className='shrink-0 text-xs leading-4 tabular-nums'>
            {pieceKeyValue({ group, defaults, values, language })}
          </span>
        </Button>
        {group.node?.capabilities.canHide ? (
          <Button
            size='icon-lg'
            variant='ghost'
            className='min-h-11 min-w-11 shrink-0'
            aria-label={t(isHidden ? 'measures.show' : 'measures.hide', { name })}
            aria-pressed={!isHidden}
            onClick={() => {
              modelInteractionRef.send({
                type: isHidden ? 'showComponent' : 'hideComponent',
                unitId,
                componentId: group.node!.id,
                source: 'explorer',
              });
            }}
          >
            {isHidden ? (
              <EyeOff aria-hidden='true' className='size-4' />
            ) : (
              <Eye aria-hidden='true' className='size-4' />
            )}
          </Button>
        ) : null}
      </div>
      {isOpen && group.node ? <PieceMaterialRow unitId={unitId} node={group.node} name={name} /> : null}
      {(isOpen || query) && group.keys.length > 0 && manifest && edit ? (
        <Parameters
          parameters={values}
          defaultParameters={defaults}
          jsonSchema={groupSchema}
          parameterManifest={manifest}
          parameterGroup={entry?.groups[entry.activeGroup]}
          parameterEdit={edit}
          units={units}
          presentation='embedded'
          presentationOptions={presentationOptions}
          enableSearch={false}
          isAllExpanded
          filterTerm={nameMatches || isSelected ? '' : filterTerm}
          onParametersChange={changeParameters}
        />
      ) : null}
    </div>
  );
});

const PieceEntry = memo(function PieceEntry({
  entryPath,
  source,
  filterTerm,
}: {
  readonly entryPath: string;
  readonly source: ParametersSource;
  readonly filterTerm: string;
}): React.JSX.Element {
  const { modelInteractionRef } = useProject();
  const { t } = useTranslation();
  const unitId = createSourceModelInteractionUnitId(entryPath);
  const componentManifest = useSelector(modelInteractionRef, (state) => state.context.unitsById[unitId]?.manifest);
  const { manifest, failure } = source.useEntry(entryPath);
  const groups = useMemo(() => {
    const groups = groupPieceMeasures(componentManifest, manifest?.defaults ?? {});
    return [...groups.filter((group) => group.node), ...groups.filter((group) => !group.node)];
  }, [componentManifest, manifest]);
  if (failure) {
    return (
      <div role='alert' className='p-3 text-sm'>
        <p>{t('measures.failure')}</p>
        <Button variant='outline' onClick={() => source.retry?.(entryPath, manifest)}>
          {t('measures.retry')}
        </Button>
      </div>
    );
  }
  if (!manifest && groups.length === 0) {
    return (
      <p role='status' className='p-3 text-sm text-muted-foreground'>
        {t('measures.loading')}
      </p>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <PieceGroup
          key={group.id}
          group={group}
          source={source}
          entryPath={entryPath}
          manifest={manifest}
          filterTerm={filterTerm}
        />
      ))}
    </>
  );
});

/** Sinopia's piece list composes Tau's parameter authority and numeric editor with the shared model selection. */
export function PieceMeasuresPane({ source }: { readonly source: ParametersSource }): React.JSX.Element {
  const { geometryUnits, modelInteractionRef } = useProject();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const entries = [...geometryUnits.keys()];
  return (
    <div
      className='flex size-full min-h-0 flex-col bg-sidebar'
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable=true]'))
        ) {
          for (const entryPath of entries) {
            modelInteractionRef.send({
              type: 'clearSelection',
              unitId: createSourceModelInteractionUnitId(entryPath),
              source: 'explorer',
            });
          }
        }
      }}
    >
      <ModelSummaryRow />
      <div className='px-3 pb-3'>
        <SearchInput
          aria-label={t('measures.search')}
          placeholder={t('measures.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onClear={() => {
            setQuery('');
          }}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {entries.length === 0 ? (
          <p className='p-3 text-sm text-muted-foreground'>{t('measures.empty')}</p>
        ) : (
          entries.map((entryPath) => (
            <PieceEntry key={entryPath} entryPath={entryPath} source={source} filterTerm={query} />
          ))
        )}
      </div>
    </div>
  );
}
