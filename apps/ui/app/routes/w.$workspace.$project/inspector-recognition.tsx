import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  catalogoFamiglie,
  domandeParametri,
  pianoCostruzione,
  pxPerMmDaMisura,
  prossimaDomanda,
  riscalaScheda,
  schedaConsegnata,
} from '@taucad/smlib/riconoscimento';
import type { SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import { consegnaVerifica, decodificaPng, esitoDaIou, richiestaDaScheda } from '@taucad/smlib/verifica';
import type { Verificatore } from '@taucad/smlib/verifica';
import { RecognitionCard } from '#components/riconoscimento/recognition-card.js';
import type { RispostaDomanda } from '#components/riconoscimento/recognition-card.js';
import { toast } from '#components/ui/sonner.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import type { ParameterFilesClient } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { useProjectParametersSource } from '#routes/w.$workspace.$project/chat-parameters.js';
import { verificaDaConsegna } from '#services/riconoscimento-pipeline.js';
import {
  leggiRecordRiconoscimento,
  percorsoMaschera,
  percorsoRiconoscimento,
  serializzaRecordRiconoscimento,
} from '#services/riconoscimento-record.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';
import { creaVerificatoreBrowser } from '#services/riconoscimento-verifica.js';

/**
 * The recognition in the inspector (SinopiaCAD D2 §2.6–2.7, T-D2-05): when the model was built from a photo, the card
 * «Riconosciuto» with its parameters and their confidences, and the questions one at a time. An answer locks the value
 * in `.tau/parameters/` (the designer's value, the lock in the Measures), drops its assumption from `main.ts` when the
 * file is still the one the recognition wrote, and runs the silhouette check (D3) again — never the classifier. The
 * answer to the scale question rescales the piece: the millimetre values the classifier guessed with its own scale are
 * brought to the measure the designer gave, then the check runs with the scale fixed.
 */

type Letto = Readonly<{ record: RecordRiconoscimento; bytes: Uint8Array<ArrayBuffer> }>;

const decoder = new TextDecoder();

const leggi = async (files: ParameterFilesClient, path: string): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  (await files.exists(path)) ? files.readFile(path) : undefined;

/** The mask of the part as the scale needs it: the PNG's white pixels. */
const mascheraDaPng = async (
  png: Uint8Array,
): Promise<{ larghezza: number; altezza: number; dati: Uint8Array<ArrayBuffer> }> => {
  const immagine = await decodificaPng(png);
  const dati = new Uint8Array(immagine.larghezza * immagine.altezza);
  for (let indice = 0; indice < dati.length; indice++) {
    dati[indice] = immagine.dati[indice * immagine.canali]! > 127 ? 1 : 0;
  }
  return { larghezza: immagine.larghezza, altezza: immagine.altezza, dati };
};

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
  const verificatore = useRef<Verificatore | undefined>(undefined);
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
      // The page leaves with a check in flight: its worker ends with it.
      verificatore.current?.chiudi();
      verificatore.current = undefined;
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
        const lingua = language === 'en' ? 'en' : 'it';
        const percorsoPng = `${root}/${percorsoMaschera(record.schedaParte.parte.id)}`;
        const mascheraPng = await leggi(parameterFiles, percorsoPng);
        let scheda: SchedaRiconoscimento = record.scheda;
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
          setAnnuncio(
            t('riconoscimento.answered', {
              value: `${formatNumber(risposta.valore, language, { maximumFractionDigits: 2 })} mm`,
            }),
          );
        } else {
          // The scale: the mask's length along the axis of the measure gives the pixels per millimetre, and the
          // millimetre values guessed with the old scale are brought to it.
          prossimo.scalaData = true;
          if (mascheraPng) {
            const pxPerMm = pxPerMmDaMisura(await mascheraDaPng(mascheraPng), {
              valoreMm: risposta.valoreMm,
              cosa: risposta.cosa,
            });
            if (pxPerMm !== undefined) {
              scheda = riscalaScheda(
                record.scheda,
                { pxPerMm, riferimento: `${risposta.valoreMm} mm (${risposta.cosa})` },
                famiglia,
              );
            }
          }
          setAnnuncio(
            t('riconoscimento.answered', {
              value: `${formatNumber(risposta.valoreMm, language, { maximumFractionDigits: 2 })} mm`,
            }),
          );
        }
        // The silhouette check again — never the classifier. The values the designer fixed stay where they are.
        let esitoSoglia: 'accettato' | 'riserva' | 'avviso' | undefined;
        if (mascheraPng && famiglia) {
          const richiesta = richiestaDaScheda(
            scheda,
            mascheraPng,
            { budgetMs: 30_000 },
            Object.keys(prossimo.risposte),
          );
          if (richiesta) {
            try {
              verificatore.current ??= creaVerificatoreBrowser();
              const verificata = await verificatore.current.verifica(richiesta);
              // One round only here (the model is not asked again): below the thresholds the best is kept with the warning.
              const soglia = esitoDaIou(verificata.iou, 1);
              esitoSoglia = soglia === 'rientro' ? 'avviso' : soglia;
              const consegna = consegnaVerifica(scheda, verificata, esitoSoglia);
              scheda = schedaConsegnata(scheda, consegna, { lingua, catalogo: famiglia });
              prossimo.verifica = verificaDaConsegna(
                consegna,
                verificata,
                prossimo.verifica.stato === 'fatta' ? (prossimo.verifica.rientri ?? 0) : 0,
              );
              prossimo.cronologia = [
                ...prossimo.cronologia,
                { quando: new Date().toISOString(), iou: consegna.iou, parametri: { ...prossimo.risposte } },
              ].slice(-50);
            } catch (error) {
              console.error('Failed to check the silhouette again:', error);
              verificatore.current?.chiudi();
              verificatore.current = undefined;
              prossimo.verifica = { stato: 'non_disponibile', motivo: 'errore' };
            }
          }
        } else {
          prossimo.verifica = { stato: 'non_disponibile', motivo: 'maschera_assente' };
        }
        if (esitoSoglia === undefined) {
          prossimo.cronologia = [
            ...prossimo.cronologia,
            { quando: new Date().toISOString(), iou: null, parametri: { ...prossimo.risposte } },
          ].slice(-50);
        }
        prossimo.scheda = scheda;
        // The assumption leaves `main.ts` only if the file is still the recognition's own.
        const piano = pianoCostruzione(scheda, {
          risposte: prossimo.risposte,
          famiglia: record.famiglia.id,
          lingua,
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
    [entry, famiglia, language, letto, mainEntryPath, manifest, parameterFiles, root, source, t],
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
            ? { stato: 'fatta', iou: record.verifica.iou, suggerimenti: record.verifica.suggerimenti ?? [] }
            : { stato: 'non_disponibile' }
        }
        {...(isBusy ? { stato: t('riconoscimento.verifying') } : {})}
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
