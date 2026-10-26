import { useSelector } from '@xstate/react';
import type { GeometryComponentNode } from '@taucad/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';
import { findPieceMaterial, pieceFinishes, pieceMaterials } from '@taucad/viewer/cad/piece-materials';
import type { PieceFinish, PieceMaterialChoice } from '@taucad/viewer/cad/piece-materials';
import { getModelInteractionUnitState } from '@taucad/viewer/machines/model-interaction.machine';
import { useProject } from '#hooks/use-project.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { pieceVolumeMm3, pieceWeight } from '#lib/piece-weight.js';

const asModelled = 'model';

/**
 * One line under a piece's measures: the material it is shown and weighed in, a metal's finish, and the estimated
 * weight (the kernel's solid volume × the material's density).
 */
export function PieceMaterialRow({
  unitId,
  node,
  name,
}: Readonly<{ unitId: string; node: GeometryComponentNode; name: string }>): React.JSX.Element {
  const { modelInteractionRef } = useProject();
  const { t, language } = useTranslation();
  const choice = useSelector(
    modelInteractionRef,
    (state) => getModelInteractionUnitState(state.context, unitId).materialByComponentId[node.id],
  );
  const material = findPieceMaterial(choice?.material);
  const weight = pieceWeight(node, choice);
  const volume = pieceVolumeMm3(node);
  const send = (next: PieceMaterialChoice | undefined): void => {
    modelInteractionRef.send({
      type: 'setComponentMaterial',
      unitId,
      componentId: node.id,
      choice: next,
      source: 'explorer',
    });
  };
  const number = (value: number, digits: number): string =>
    formatNumber(value, language, { maximumFractionDigits: digits });
  const weightText = weight
    ? t('materials.weight', { mass: number(weight.grams, weight.grams < 10 ? 2 : 1) })
    : volume === undefined
      ? t('materials.noVolume')
      : t('materials.noMaterial');
  const basis = weight
    ? t(material?.platedOn ? 'materials.weightPlated' : 'materials.weightBasis', {
        volume: number(weight.volumeMm3, 1),
        density: number(weight.density, 2),
      })
    : undefined;

  return (
    <div className='flex flex-col gap-1.5 px-3 pt-1 pb-2' data-slot='piece-material-row'>
      <div className='flex min-w-0 items-center gap-1.5'>
        <Select
          size='sm'
          value={choice?.material ?? asModelled}
          onValueChange={(value) => {
            const picked = findPieceMaterial(value);
            send(picked ? { material: picked.id, ...(choice?.finish ? { finish: choice.finish } : {}) } : undefined);
          }}
        >
          <SelectTrigger className='min-w-0 flex-1 text-xs' aria-label={t('materials.materialOf', { name })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position='popper'>
            <SelectItem value={asModelled}>{t('materials.asModelled')}</SelectItem>
            {pieceMaterials.map(({ id }) => (
              <SelectItem key={id} value={id}>
                {t(`materials.names.${id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {material?.kind === 'metal' ? (
          <Select
            size='sm'
            value={choice?.finish ?? 'polished'}
            onValueChange={(value) => {
              send({ material: material.id, finish: value as PieceFinish });
            }}
          >
            <SelectTrigger className='w-24 shrink-0 text-xs' aria-label={t('materials.finishOf', { name })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position='popper'>
              {pieceFinishes.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`materials.finishes.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <p className='text-xs leading-4 text-muted-foreground tabular-nums' title={basis} data-slot='piece-weight'>
        {weightText}
      </p>
    </div>
  );
}
