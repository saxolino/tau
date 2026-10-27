import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  catalogoFamiglie,
  domandeParametri,
  pianoCostruzione,
  prossimaDomanda,
  verificaSilhouette,
} from '@taucad/smlib/riconoscimento';
import { RecognitionCard } from '#components/riconoscimento/recognition-card.js';
import type { RispostaDomanda } from '#components/riconoscimento/recognition-card.js';
import { toast } from '#components/ui/sonner.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import type { ParameterFilesClient } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { useProjectParametersSource } from '#routes/w.$workspace.$project/chat-parameters.js';
import {
  leggiRecordRiconoscimento,
  percorsoRiconoscimento,
  serializzaRecordRiconoscimento,
} from '#services/riconoscimento-record.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';

/**
 * The recognition in the inspector (SinopiaCAD D2 §2.6–2.7, T-D2-05): when the model was built from a photo, the card
 * «Riconosciuto» with its parameters and their confidences, and the questions one at a time. An answer locks the value
 * in `.tau/parameters/` (the designer's value, the lock in the Measures), drops its assumption from `main.ts` when the
 * file is still the one the recognition wrote, and runs the silhouette check (D3) again — never the classifier.
 */

type Letto = Readonly<{ record: RecordRiconoscimento; bytes: Uint8Array<ArrayBuffer> }>;

const decoder = new TextDecoder();

const leggi = async (files: ParameterFilesClient, path: string): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  (await files.exists(path)) ? files.readFile(path) : undefined;

const puntatore = (chiave: string): string =>
  `/${chiave
    .split('.')
    .map((parte) => parte.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;

/**
 * The recognition card of the open project, or nothing when the project was not built from a photo.
 *
 * @returns The section, or undefined.
 */
export function InspectorRecognition(): React.JSX.Element | undefined {
  const { t, language } = useTranslation();
  const { projectId, mainEntryPath } = useProject();
  const { parameterFiles } = useFileManager();
  const source = useProjectParametersSource();
  const { manifest, entry } = source.useEntry(mainEntryPath);
  const root = `/projects/${projectId}`;
  const [letto, setLetto] = useState<Letto>();
  const [isBusy, setIsBusy] = useState(false);
  const [annuncio, setAnnuncio] = useState('');
  const catalogo = useMemo(() => catalogoFamiglie(), []);
  const vivo = useRef(true);
  const { selection } = useInspectorSelection();

  useEffect(() => {
    vivo.current = true;
    // async-iife: bootstrap -- read the record once per project; an absent or unreadable record shows nothing.
    void (async (): Promise<void> => {
      try {
        const bytes = await leggi(parameterFiles, `${root}/${percorsoRiconoscimento}`);
        const lettura = leggiRecordRiconoscimento(bytes);
        if (vivo.current && lettura.stato === 'ok' && bytes) {
          setLetto({ record: lettura.record, bytes });
        }
      } catch (error) {
        console.error('Failed to read the recognition record:', error);
      }
    })();
    return () => {
      vivo.current = false;
    };
  }, [parameterFiles, root]);

  const famiglia = letto ? catalogo.find((voce) => voce.id === letto.record.famiglia.id) : undefined;
  const risposteChiavi = useMemo(() => new Set(Object.keys(letto?.record.risposte ?? {})), [letto]);
  const domanda = letto
    ? prossimaDomanda(letto.record.scheda, famiglia, {
        risposte: risposteChiavi,
        famigliaScelta: true,
        scalaData: letto.record.scalaData,
      })
    : undefined;
  // The queue as the designer sees it: parameter questions asked and still to ask (three at most), then the scale.
  const scalaStimata = letto?.record.scheda.scala.fonte === 'stima';
  const restanti = letto && famiglia ? domandeParametri(letto.record.scheda, famiglia, risposteChiavi).length : 0;
  const totale = Math.min(3, risposteChiavi.size + restanti) + (scalaStimata ? 1 : 0);
  const corrente = risposteChiavi.size + (scalaStimata && letto.record.scalaData ? 1 : 0) + 1;

  const rispondi = useCallback(
    async (risposta: RispostaDomanda): Promise<void> => {
      if (!letto || risposta.tipo === 'famiglia') {
        return;
      }
      setIsBusy(true);
      try {
        const { record } = letto;
        const prossimo: RecordRiconoscimento = structuredClone(record);
        if (risposta.tipo === 'parametro') {
          if (manifest && entry) {
            const esito = await source.commitValue(mainEntryPath, manifest, {
              pointer: puntatore(risposta.chiave),
              value: risposta.valore,
              group: entry.activeGroup,
            });
            if (esito.status !== 'committed') {
              throw new Error(`Parameter not committed: ${esito.status}`);
            }
          }
          prossimo.risposte[risposta.chiave] = risposta.valore;
          // The assumption leaves `main.ts` only if the file is still the recognition's own.
          const piano = pianoCostruzione(record.scheda, {
            risposte: prossimo.risposte,
            famiglia: record.famiglia.id,
            lingua: language === 'en' ? 'en' : 'it',
          });
          const mainPath = `${root}/${mainEntryPath}`;
          const attuale = await leggi(parameterFiles, mainPath);
          if (piano && attuale && decoder.decode(attuale) === record.mainScritto) {
            const scritto = await parameterFiles.writeFileChecked({
              path: mainPath,
              data: piano.main,
              preconditions: [{ path: mainPath, expected: attuale }],
            });
            if (scritto.status !== 'conflict') {
              prossimo.mainScritto = piano.main;
            }
          }
          const verifica = await verificaSilhouette({
            famiglia: record.famiglia.id,
            variante: record.famiglia.variante,
            parametri: piano?.parametri ?? {},
            bloccati: Object.keys(prossimo.risposte),
            vista: record.scheda.vista,
            scala: record.scheda.scala,
            maschera: {
              png: new Uint8Array(),
              larghezzaPx: record.schedaParte.immagine.larghezzaPx,
              altezzaPx: record.schedaParte.immagine.altezzaPx,
            },
            stime: record.scheda.parametri,
          });
          prossimo.verifica = verifica.disponibile
            ? { stato: 'fatta', iou: verifica.iou, camera: { ...verifica.camera } }
            : { stato: 'non_disponibile', motivo: verifica.motivo };
          prossimo.cronologia = [
            ...prossimo.cronologia,
            {
              quando: new Date().toISOString(),
              iou: verifica.disponibile ? verifica.iou : null,
              parametri: { ...prossimo.risposte },
            },
          ].slice(-50);
          setAnnuncio(
            t('riconoscimento.answered', {
              value: `${formatNumber(risposta.valore, language, { maximumFractionDigits: 2 })} mm`,
            }),
          );
        } else {
          prossimo.scalaData = true;
          setAnnuncio(
            t('riconoscimento.answered', {
              value: `${formatNumber(risposta.valoreMm, language, { maximumFractionDigits: 2 })} mm`,
            }),
          );
        }
        const path = `${root}/${percorsoRiconoscimento}`;
        const testo = serializzaRecordRiconoscimento(prossimo);
        const scritto = await parameterFiles.writeFileChecked({
          path,
          data: testo,
          preconditions: [{ path, expected: letto.bytes }],
        });
        if (scritto.status === 'conflict') {
          throw new Error('Recognition record changed meanwhile');
        }
        if (vivo.current) {
          setLetto({ record: prossimo, bytes: scritto.content });
        }
      } catch (error) {
        console.error('Failed to save the answer to the recognition:', error);
        toast.error(t('riconoscimento.errors.saveFailed'));
      } finally {
        if (vivo.current) {
          setIsBusy(false);
        }
      }
    },
    [entry, language, letto, mainEntryPath, manifest, parameterFiles, root, source, t],
  );

  // The card belongs to the model as a whole: a selected piece shows its own measures, with the same markers.
  if (!letto || selection.kind !== 'model') {
    return undefined;
  }
  const { record } = letto;
  return (
    <section
      aria-label={t('riconoscimento.recognized')}
      className='border-b border-border px-4 py-3'
      data-slot='inspector-recognition'
    >
      <RecognitionCard
        scheda={record.scheda}
        famiglia={famiglia}
        variante={record.famiglia.variante}
        risposte={record.risposte}
        verifica={
          record.verifica.stato === 'fatta'
            ? { stato: 'fatta', iou: record.verifica.iou }
            : { stato: 'non_disponibile' }
        }
        {...(domanda && domanda.tipo !== 'famiglia'
          ? {
              domanda,
              posizioneDomanda: { corrente: Math.min(corrente, Math.max(totale, 1)), totale: Math.max(totale, 1) },
              onRisposta: (risposta: RispostaDomanda) => {
                void rispondi(risposta);
              },
            }
          : {})}
        isBusy={isBusy}
      />
      <p role='status' aria-live='polite' className='sr-only'>
        {annuncio}
      </p>
    </section>
  );
}
