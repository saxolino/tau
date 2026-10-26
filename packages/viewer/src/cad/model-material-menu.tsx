import { useCallback, useMemo } from 'react';
import { Gem, SprayCan } from 'lucide-react';
import { DropdownMenuSelectItem } from '@taucad/ui/components/menu-slider-item';
import { findPieceMaterial, pieceFinishes, pieceMaterials } from '#cad/piece-materials.js';
import type { PieceFinish, PieceMaterialChoice } from '#cad/piece-materials.js';
import { englishMaterialLabels, useViewerLabels } from '#environment/viewer-environment.jsx';
import { useGraphicsSelector, useModelInteractionRef, useModelInteractionSelector } from '#hooks/use-graphics.jsx';
import { getModelInteractionUnitState } from '#machines/model-interaction.machine.js';

type Option = Readonly<{ value: string; label: string }>;

const asModelled = 'model';
const mixed = 'mixed';
const getValue = (option: Option): string => option.value;
const getLabel = (option: Option): string => option.label;

/** One value when every piece agrees, `mixed` otherwise. */
function common(values: readonly string[]): string | undefined {
  const [first] = values;
  return values.every((value) => value === first) ? first : mixed;
}

/**
 * The settings menu's model-wide material and finish: picking one dresses every piece of the model on screen; the
 * pieces' own rows (in the host's measures) can then differ. Shown only while a model with pieces is presented.
 *
 * @returns The two menu rows, or nothing without pieces.
 * @public
 */
export function ModelMaterialMenuRows(): React.JSX.Element | undefined {
  const labels = useViewerLabels().materials ?? englishMaterialLabels;
  const unitId = useGraphicsSelector((state) => state.context.modelInteractionUnitId);
  const modelInteractionRef = useModelInteractionRef();
  const unit = useModelInteractionSelector((state) =>
    unitId === undefined ? undefined : getModelInteractionUnitState(state.context, unitId),
  );
  const pieceIds = useMemo(
    () => unit?.manifest?.nodeOrder.filter((id) => unit.manifest?.nodesById[id]?.kind === 'part') ?? [],
    [unit?.manifest],
  );
  const choices = useMemo(
    () => pieceIds.map((id) => unit?.materialByComponentId[id]),
    [pieceIds, unit?.materialByComponentId],
  );
  const material = common(choices.map((choice) => choice?.material ?? asModelled)) ?? asModelled;
  const metalChoices = choices.filter(
    (choice): choice is PieceMaterialChoice => findPieceMaterial(choice?.material)?.kind === 'metal',
  );
  const finish = common(metalChoices.map((choice) => choice.finish ?? 'polished'));

  const materialOptions = useMemo(
    (): Option[] => [
      { value: asModelled, label: labels.asModelled },
      ...(material === mixed ? [{ value: mixed, label: labels.mixed }] : []),
      ...pieceMaterials.map(({ id }) => ({ value: id, label: labels.names[id] })),
    ],
    [labels, material],
  );
  const finishOptions = useMemo(
    (): Option[] => [
      ...(finish === mixed ? [{ value: mixed, label: labels.mixed }] : []),
      ...pieceFinishes.map((id) => ({ value: id, label: labels.finishes[id] })),
    ],
    [finish, labels],
  );

  const send = useCallback(
    (componentId: string | undefined, choice: PieceMaterialChoice | undefined) => {
      if (unitId !== undefined) {
        modelInteractionRef.send({ type: 'setComponentMaterial', unitId, componentId, choice, source: 'viewer' });
      }
    },
    [modelInteractionRef, unitId],
  );
  const changeMaterial = useCallback(
    (value: string) => {
      if (value === mixed) {
        return;
      }
      const picked = findPieceMaterial(value);
      const keptFinish = finish === mixed || finish === undefined ? undefined : (finish as PieceFinish);
      send(undefined, picked ? { material: picked.id, ...(keptFinish ? { finish: keptFinish } : {}) } : undefined);
    },
    [finish, send],
  );
  const changeFinish = useCallback(
    (value: string) => {
      if (value === mixed) {
        return;
      }
      for (const [index, id] of pieceIds.entries()) {
        const choice = choices[index];
        if (choice && findPieceMaterial(choice.material)?.kind === 'metal') {
          send(id, { material: choice.material, finish: value as PieceFinish });
        }
      }
    },
    [choices, pieceIds, send],
  );

  if (pieceIds.length === 0) {
    return undefined;
  }
  const materialValue = materialOptions.find((option) => option.value === material) ?? materialOptions[0]!;
  const finishValue = finishOptions.find((option) => option.value === finish);
  return (
    <>
      <DropdownMenuSelectItem
        value={materialValue}
        options={materialOptions}
        getOptionValue={getValue}
        getOptionLabel={getLabel}
        title={labels.modelMaterial}
        description={labels.modelMaterial}
        onValueChange={changeMaterial}
      >
        <Gem />
        {labels.modelMaterial}
      </DropdownMenuSelectItem>
      {finishValue ? (
        <DropdownMenuSelectItem
          value={finishValue}
          options={finishOptions}
          getOptionValue={getValue}
          getOptionLabel={getLabel}
          title={labels.modelFinish}
          description={labels.modelFinish}
          onValueChange={changeFinish}
        >
          <SprayCan />
          {labels.modelFinish}
        </DropdownMenuSelectItem>
      ) : undefined}
    </>
  );
}
