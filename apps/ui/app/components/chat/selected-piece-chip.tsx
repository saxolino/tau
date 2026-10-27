import { useSelector } from '@xstate/react';
import { MessageCircle, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { getActiveGroupValues } from '@taucad/types';
import { useSelectedPiece } from '#hooks/use-selected-piece.js';
import { useParameterSetActor, useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import { groupPieceMeasures, pieceKeyValue, readablePieceName } from '#lib/piece-measures.js';
import { geometryReferenceToToken, useChatContextInsertion } from '#components/chat/chat-context-insertion.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';

/** The same selection in the viewport and above the message field; closing it clears the shared selection. */
export function SelectedPieceChip({
  entryPath,
  location,
}: {
  readonly entryPath?: string;
  readonly location: 'viewer' | 'composer';
}): React.JSX.Element | undefined {
  const selected = useSelectedPiece(entryPath);
  return selected ? <SelectedPieceDetail selected={selected} location={location} /> : undefined;
}

function SelectedPieceDetail({
  selected,
  location,
}: {
  readonly selected: NonNullable<ReturnType<typeof useSelectedPiece>>;
  readonly location: 'viewer' | 'composer';
}): React.JSX.Element {
  const project = useProject({ enableNoContext: true });
  const { t, language } = useTranslation();
  const { addContextReferences } = useChatContextInsertion();
  const workspace = useProjectWorkspace({ enableNoContext: true });
  const selectedPath = selected.reference?.filePath ?? '';
  const parameterActor = useParameterSetActor(selectedPath);
  const record = useSelector(parameterActor, (state) => state?.context.current?.entry);
  const parameters = useSelector(project?.geometryUnits.get(selectedPath), (state) => state?.context.parameterManifest);
  const name = readablePieceName(selected.node.name, language);
  // A face or edges picked with the inspector's tools narrow what the assistant is told about.
  const sub = workspace?.inspectorSubSelection;
  const detail =
    sub?.componentId === selected.node.id
      ? sub.kind === 'face'
        ? t(`inspector.faces.${sub.direction}`)
        : t(sub.edgeCount === 1 ? 'manualEdit.describe.edgesPickedOne' : 'manualEdit.describe.edgesPicked', {
            count: sub.edgeCount,
          })
      : undefined;
  const group = groupPieceMeasures(selected.manifest, parameters?.defaults ?? {}).find(
    (candidate) => candidate.node?.id === selected.node.id,
  );
  const value = group
    ? pieceKeyValue({ group, defaults: parameters?.defaults ?? {}, values: getActiveGroupValues(record), language })
    : '';
  return (
    <div
      className={
        location === 'viewer'
          ? 'pointer-events-auto absolute top-3 left-3 z-20 flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 shadow-md'
          : 'flex items-center gap-1 border-b border-border px-3 py-1 text-xs'
      }
    >
      <span className='min-w-0 truncate text-xs' title={name}>
        {location === 'composer'
          ? t('measures.looking', { name: detail ? `${name} · ${detail}` : name })
          : `${name}${value ? ` · ${value}` : ''}`}
      </span>
      {location === 'viewer' && selected.reference ? (
        <Button
          variant='ghost'
          size='sm'
          className='min-h-11 shrink-0'
          onClick={() => {
            if (!selected.reference) {
              return;
            }
            workspace?.setChatOpen(true);
            addContextReferences([
              {
                id: geometryReferenceToToken(selected.reference),
                label: name,
                chipType: 'geometry',
                referenceToken: geometryReferenceToToken(selected.reference),
                geometryReference: { ...selected.reference, label: name },
              },
            ]);
          }}
        >
          <MessageCircle aria-hidden='true' className='size-3' />
          {t('measures.ask')}
        </Button>
      ) : null}
      <Button
        variant='ghost'
        size='icon-lg'
        className='min-h-11 min-w-11 shrink-0'
        aria-label={t('measures.clear')}
        onClick={() => selected.actor?.send({ type: 'clearSelection', unitId: selected.unitId, source: 'chat' })}
      >
        <X aria-hidden='true' className='size-3' />
      </Button>
    </div>
  );
}
