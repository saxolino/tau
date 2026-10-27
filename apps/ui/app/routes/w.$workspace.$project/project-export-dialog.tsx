import { useCallback, useEffect, useState } from 'react';
import { useSelector } from '@xstate/react';
import { deriveModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';
import { useTranslation } from '#i18n/translate.js';
import { useProject } from '#hooks/use-project.js';
import { useProjectExport } from '#hooks/use-project-export.js';
import { useChatSessionStore } from '#hooks/chat-session-store-provider.js';
import { toast } from '#components/ui/sonner.js';
import { ExportDialogView } from '#routes/w.$workspace.$project/project-export-dialog-view.js';
import { useProducibilita } from '#routes/w.$workspace.$project/producibilita-context.js';
import { ProducibilityExportGate } from '#routes/w.$workspace.$project/producibility-export-gate.js';
import type { SceltaEsportazione } from '#services/producibilita-record.js';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import { ProjectDeliverySection } from '#routes/w.$workspace.$project/project-delivery-section.js';
import { projectExportFormats } from '#services/project-export.types.js';
import type { ProjectExportFormat } from '#services/project-export.types.js';

/** Models of other kernels: no IGES, DXF or PDF sheet, which the delivery writes from SMLib models only. */
const meshFormats: readonly ProjectExportFormat[] = projectExportFormats.filter(
  (format) => format !== 'iges' && format !== 'dxf' && format !== 'pdf',
);

/** Write the choice made in front of the soft block to the project's register, without holding the dialog. */
const registra = (
  producibilita: NonNullable<ReturnType<typeof useProducibilita>>,
  scelta: SceltaEsportazione,
  blocchi: readonly ControlloProducibilita[],
): void => {
  // async-iife: bootstrap -- the register follows the choice; the choice does not wait for the file.
  void (async (): Promise<void> => {
    try {
      await producibilita.registraScelta(scelta, blocchi);
    } catch (error) {
      console.error('Failed to register the export choice:', error);
    }
  })();
};

export function ProjectExportDialog({
  onOpenChange,
  onShowAgent,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onShowAgent: () => void;
}): React.JSX.Element {
  const { projectRef, editorRef, modelInteractionRef, mainEntryPath } = useProject();
  const name = useSelector(projectRef, (state) => state.context.project?.name) ?? '';
  const store = useChatSessionStore();
  const { t } = useTranslation();
  const { pieces, sketches, prepare, capturePhoto, deliveryAvailable, deliveryPieces, partType } = useProjectExport();
  const askAgent = useCallback(
    (message: string): void => {
      const chatId = editorRef.getSnapshot().context.focusedChatId;
      const session = chatId ? store.get(chatId) : undefined;
      if (!session) {
        toast.error(t('export.draftUnavailable'));
        onShowAgent();
        return;
      }
      const existing = session.draftActorRef.getSnapshot().context.draftText;
      session.draftActorRef.send({ type: 'setDraftText', text: existing ? `${existing}\n\n${message}` : message });
      onOpenChange(false);
      onShowAgent();
    },
    [editorRef, onOpenChange, onShowAgent, store, t],
  );
  // The soft block (E1): checks that block production come first; once passed (or found clear) it does not return
  // while this dialog stays open.
  const producibilita = useProducibilita();
  const [isGatePassed, setIsGatePassed] = useState(false);
  const isChecking = producibilita?.stato === 'in_corso' && !producibilita.aggiornati;
  const blocchi = producibilita?.aggiornati ? producibilita.blocchi : [];
  useEffect(() => {
    if (!isChecking && blocchi.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- A clear verdict lets the export through for good.
      setIsGatePassed(true);
    }
  }, [isChecking, blocchi.length]);
  if (producibilita && !isGatePassed && (isChecking || blocchi.length > 0)) {
    return (
      <ProducibilityExportGate
        isChecking={isChecking}
        blocchi={blocchi}
        onOpenChange={onOpenChange}
        onExportAnyway={() => {
          if (blocchi.length > 0) {
            registra(producibilita, 'esporta_comunque', blocchi);
          }
          setIsGatePassed(true);
        }}
        onFix={() => {
          const [primo] = blocchi;
          registra(producibilita, 'correggi', blocchi);
          const pezzo = producibilita.pezzi.find(({ nome }) => nome === primo?.pezzo);
          if (pezzo) {
            modelInteractionRef.send({
              type: 'selectComponent',
              unitId: deriveModelInteractionUnitId({ sourceFile: mainEntryPath }),
              componentId: pezzo.componentId,
              source: 'explorer',
            });
          }
          producibilita.setFocus(primo?.id);
          onOpenChange(false);
          onShowAgent();
        }}
      />
    );
  }
  return (
    <ExportDialogView
      name={name}
      pieces={pieces}
      sketches={sketches}
      prepare={prepare}
      capture={capturePhoto}
      onAskAgent={askAgent}
      onOpenChange={onOpenChange}
      formats={deliveryAvailable ? projectExportFormats : meshFormats}
      delivery={
        deliveryAvailable
          ? ({ rows, selectedNames }) => (
              <ProjectDeliverySection
                name={name}
                rows={rows}
                selectedNames={selectedNames}
                capture={capturePhoto}
                pieces={deliveryPieces}
                partType={partType}
              />
            )
          : undefined
      }
    />
  );
}
