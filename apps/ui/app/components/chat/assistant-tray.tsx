import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import type { ValoreParametro } from '@taucad/smlib/famiglie';
import type { EsitoVarianti, Modifica, VarianteValutata } from '@taucad/smlib/varianti';
import { createSourceModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';
import { AssistantBriefCard } from '#components/chat/assistant-brief-card.js';
import type { ControlliScheda } from '#components/chat/assistant-brief-card.js';
import { AssistantChangeCard } from '#components/chat/assistant-change-card.js';
import type { RigaCambiamento, StatoAnnulla } from '#components/chat/assistant-change-card.js';
import { AssistantContextChips, useAssistantComposer } from '#components/chat/assistant-suggestions.js';
import { AssistantVariantsCard } from '#components/chat/assistant-variants-card.js';
import type { ContenutoVarianti, VarianteCard } from '#components/chat/assistant-variants-card.js';
import { toast } from '#components/ui/sonner.js';
import { useAssistantModel } from '#hooks/use-assistant-model.js';
import type { ModelloAssistente } from '#hooks/use-assistant-model.js';
import { useChatSelector, useDraftActions } from '#hooks/use-chat.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { useProject } from '#hooks/use-project.js';
import type { Language } from '#i18n/language.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey, Translate } from '#i18n/translate.js';
import { chipsAssistente, rigaEsito, rigaModifica, schedaModello } from '#lib/assistant-brief.js';
import { controlliDaProducibilita } from '#lib/scheda-controlli.js';
import type { ChipAssistente } from '#lib/assistant-brief.js';
import type { BloccoVarianti, InsiemeAgente } from '#lib/assistant-variants-marker.js';
import { groupPieceMeasures, pieceNameKey, readablePieceName } from '#lib/piece-measures.js';
import { useProducibilita } from '#routes/w.$workspace.$project/producibilita-context.js';
import { chiudiValutatoreVarianti, prendiValutatoreVarianti } from '#services/varianti-worker.js';

/**
 * The assistant's tray (SinopiaCAD D4, D5): the card about the open model and its next steps, the variants side by
 * side, and «Cosa ho cambiato» after a change it made, shared by the strip under the inspector and the conversation.
 * Changes go through the parameter service in one write (one entry of the history); «Annulla» writes the values back
 * as they were, only while nobody changed them since.
 */

/** A change the assistant made with a click, and how to take it back. */
type UltimaModifica = Readonly<{
  id: number;
  sottotitolo: string;
  righe: readonly RigaCambiamento[];
  /** The active group's values before and after. */
  prima: Record<string, unknown>;
  dopo: Record<string, unknown>;
}>;

/** The variants asked with the chip: being prepared, failed, or ready (with their previews as object URLs). */
type SessioneVarianti =
  | Readonly<{ id: number; stato: 'caricamento' }>
  | Readonly<{ id: number; stato: 'errore' }>
  | Readonly<{
      id: number;
      stato: 'pronto';
      esito: EsitoVarianti;
      anteprime: ReadonlyMap<string, string>;
      scartate: ReadonlySet<string>;
    }>;

/** What the tray offers its surfaces. */
export type AssistantTrayValue = Readonly<{
  modello: ModelloAssistente;
  sessione?: SessioneVarianti;
  modifica?: UltimaModifica;
  annullamento: boolean;
  chipInCorso?: string;
  varianteInApplicazione?: string;
  apriVarianti: () => Promise<void>;
  chiudiVarianti: () => void;
  scartaVariante: (id: string) => void;
  valutaInsiemi: (insiemi: readonly InsiemeAgente[]) => Promise<EsitoVarianti>;
  /** Resolves true once the variant is the model. */
  usaVariante: (variante: VarianteValutata, nome: string) => Promise<boolean>;
  /** Resolves true once the values are written; a failure is said with a toast. */
  applicaModifiche: (
    input: Readonly<{ modifiche: readonly Modifica[]; sottotitolo: string; chip?: string }>,
  ) => Promise<boolean>;
  annullaModifica: () => Promise<void>;
  chiudiModifica: () => void;
  selezionaPezzo: (nome: string) => void;
}>;

/**
 * The tray's context: provided by {@link AssistantTrayProvider}; exported for the tests of its consumers.
 */
export const AssistantTrayContext = createContext<AssistantTrayValue | undefined>(undefined);

/**
 * The tray of the open project, or undefined outside a provider (the phone's lane has none).
 *
 * @returns The tray.
 */
export function useAssistantTray(): AssistantTrayValue | undefined {
  return useContext(AssistantTrayContext);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const uguali = (a: unknown, b: unknown): boolean => {
  if (isRecord(a) && isRecord(b)) {
    const chiavi = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...chiavi].every((chiave) => uguali(a[chiave], b[chiave]));
  }
  return Object.is(a, b);
};

const scrivi = (valori: Record<string, unknown>, chiave: string, valore: ValoreParametro): void => {
  const parti = chiave.split('.');
  let nodo = valori;
  for (const parte of parti.slice(0, -1)) {
    const prossimo = nodo[parte];
    if (isRecord(prossimo)) {
      nodo = prossimo;
    } else {
      const nuovo: Record<string, unknown> = {};
      nodo[parte] = nuovo;
      nodo = nuovo;
    }
  }
  nodo[parti.at(-1)!] = valore;
};

const leggi = (valori: unknown, chiave: string): unknown => {
  let nodo = valori;
  for (const parte of chiave.split('.')) {
    if (!isRecord(nodo)) {
      return undefined;
    }
    nodo = nodo[parte];
  }
  return nodo;
};

/** Previews of the variants: the size the worker renders (shown at about half, sharp on a 2× screen). */
const anteprima = { larghezza: 160, altezza: 120 } as const;

const urlAnteprime = (esito: EsitoVarianti): Map<string, string> =>
  new Map(
    esito.varianti.flatMap((variante) =>
      variante.anteprimaPng
        ? [[variante.id, URL.createObjectURL(new Blob([variante.anteprimaPng], { type: 'image/png' }))] as const]
        : [],
    ),
  );

const revoca = (anteprime: ReadonlyMap<string, string> | undefined): void => {
  for (const url of anteprime?.values() ?? []) {
    URL.revokeObjectURL(url);
  }
};

/**
 * The tray's state and actions for the open project. Mounted with the assistant (the dock under the inspector), so
 * the strip and the conversation share one model, one variants session and one «Cosa ho cambiato».
 *
 * @param props - The assistant's surfaces.
 * @returns The provider.
 */
export function AssistantTrayProvider({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const { parameterService, modelInteractionRef } = useProject();
  const [valutatore] = useState(prendiValutatoreVarianti);
  useEffect(
    () => () => {
      chiudiValutatoreVarianti();
    },
    [],
  );
  const modello = useAssistantModel(valutatore);
  const units = useSelector(modelInteractionRef, (state) => state.context);
  const [sessione, setSessione] = useState<SessioneVarianti>();
  const [modifica, setModifica] = useState<UltimaModifica>();
  const [annullamento, setAnnullamento] = useState(false);
  const [chipInCorso, setChipInCorso] = useState<string>();
  const [varianteInApplicazione, setVarianteInApplicazione] = useState<string>();
  // Values the assistant wrote with a click: still variable for the next variants, until the designer changes them.
  const [scritti, setScritti] = useState<ReadonlyMap<string, ValoreParametro>>(new Map());
  const sequenza = useRef(0);
  const anteprimeAperte = useRef<ReadonlyMap<string, string> | undefined>(undefined);

  const sostituisciSessione = useCallback((prossima: SessioneVarianti | undefined) => {
    revoca(anteprimeAperte.current);
    anteprimeAperte.current = prossima?.stato === 'pronto' ? prossima.anteprime : undefined;
    setSessione(prossima);
  }, []);
  useEffect(
    () => () => {
      revoca(anteprimeAperte.current);
    },
    [],
  );

  const bloccati = useMemo(
    () =>
      modello.bloccati.filter((chiave) => {
        const scritto = scritti.get(chiave);
        return scritto === undefined || !Object.is(scritto, leggi(modello.valori, chiave));
      }),
    [modello.bloccati, modello.valori, scritti],
  );

  const { famiglia } = modello;
  const apriVarianti = useCallback(async (): Promise<void> => {
    if (!famiglia) {
      return;
    }
    // The newest request wins: an older answer is dropped with its previews.
    const id = ++sequenza.current;
    sostituisciSessione({ id, stato: 'caricamento' });
    try {
      const esito = await valutatore.proponi({
        famiglia: famiglia.definizione.id,
        variante: famiglia.variante,
        attuali: famiglia.parametri,
        bloccati,
        anteprima,
      });
      if (sequenza.current === id) {
        sostituisciSessione({ id, stato: 'pronto', esito, anteprime: urlAnteprime(esito), scartate: new Set() });
      }
    } catch (error) {
      console.error('The variants could not be prepared:', error);
      if (sequenza.current === id) {
        sostituisciSessione({ id, stato: 'errore' });
      }
    }
  }, [bloccati, famiglia, sostituisciSessione, valutatore]);

  const chiudiVarianti = useCallback(() => {
    sequenza.current++;
    sostituisciSessione(undefined);
  }, [sostituisciSessione]);

  const scartaVariante = useCallback(
    (id: string) => {
      if (sessione?.stato !== 'pronto') {
        return;
      }
      const scartate = new Set([...sessione.scartate, id]);
      if (sessione.esito.varianti.every((variante) => scartate.has(variante.id))) {
        chiudiVarianti();
        return;
      }
      setSessione({ ...sessione, scartate });
    },
    [chiudiVarianti, sessione],
  );

  const valutaInsiemi = useCallback(
    async (insiemi: readonly InsiemeAgente[]): Promise<EsitoVarianti> => {
      if (!famiglia) {
        throw new Error('The model is not of a family.');
      }
      return valutatore.proponi({
        famiglia: famiglia.definizione.id,
        variante: famiglia.variante,
        attuali: famiglia.parametri,
        bloccati,
        insiemi: insiemi.map((insieme, indice) => ({ ...insieme, id: `agente-${indice + 1}` })),
        anteprima,
      });
    },
    [bloccati, famiglia, valutatore],
  );

  const pezzoDi = useMemo(() => {
    const manifest = units.unitsById[createSourceModelInteractionUnitId(modello.entryPath)]?.manifest;
    const gruppi = groupPieceMeasures(manifest, famiglia?.parametri ?? {});
    return (chiave: string): string | undefined => {
      const [testa = ''] = chiave.split('.');
      const nodo = gruppi.find((gruppo) => gruppo.keys.includes(testa))?.node;
      return nodo ? readablePieceName(nodo.name, language) : undefined;
    };
  }, [famiglia?.parametri, language, modello.entryPath, units.unitsById]);

  const applicaModifiche = useCallback(
    async ({
      modifiche,
      sottotitolo,
      chip,
    }: Readonly<{ modifiche: readonly Modifica[]; sottotitolo: string; chip?: string }>): Promise<boolean> => {
      const { manifest } = modello;
      if (!manifest || !famiglia || modifiche.length === 0) {
        return false;
      }
      setChipInCorso(chip);
      try {
        const prima = structuredClone(modello.valori) as Record<string, unknown>;
        const dopo = structuredClone(prima);
        for (const voce of modifiche) {
          scrivi(dopo, voce.chiave, voce.dopo);
        }
        // One write of the active group: one entry of the history, «Annulla» writes `prima` back the same way.
        await parameterService.replaceValues(modello.entryPath, manifest, dopo);
        setScritti((attuali) => new Map([...attuali, ...modifiche.map((voce) => [voce.chiave, voce.dopo] as const)]));
        setModifica({
          id: Date.now(),
          sottotitolo,
          righe: modifiche.map((voce) => {
            const riga = rigaModifica(famiglia.definizione, voce, language);
            const pezzo = pezzoDi(voce.chiave);
            return { ...riga, ...(pezzo ? { pezzo, selezionabile: true } : {}) };
          }),
          prima,
          dopo,
        });
        return true;
      } catch (error) {
        console.error('The assistant could not apply its change:', error);
        toast.error(t('assistant.change.applyFailed'));
        return false;
      } finally {
        setChipInCorso(undefined);
      }
    },
    [famiglia, language, modello, parameterService, pezzoDi, t],
  );

  const usaVariante = useCallback(
    async (variante: VarianteValutata, nome: string): Promise<boolean> => {
      const derivati = new Set(
        famiglia?.definizione.parametri.flatMap((definizione) => (definizione.derivato ? [definizione.chiave] : [])),
      );
      setVarianteInApplicazione(variante.id);
      try {
        const applicata = await applicaModifiche({
          modifiche: variante.differenze
            .filter((differenza) => !derivati.has(differenza.chiave))
            .map(({ chiave, prima, dopo }) => ({ chiave, prima, dopo })),
          sottotitolo: t('assistant.change.variant', { name: nome }),
        });
        if (applicata) {
          chiudiVarianti();
        }
        return applicata;
      } finally {
        setVarianteInApplicazione(undefined);
      }
    },
    [applicaModifiche, chiudiVarianti, famiglia, t],
  );

  const annullaModifica = useCallback(async () => {
    const { manifest } = modello;
    if (!modifica || !manifest) {
      return;
    }
    setAnnullamento(true);
    try {
      await parameterService.replaceValues(modello.entryPath, manifest, modifica.prima);
      setScritti((attuali) => new Map([...attuali].filter(([chiave]) => leggi(modifica.dopo, chiave) === undefined)));
      setModifica(undefined);
      toast.success(t('assistant.change.undone'));
    } catch (error) {
      console.error('The assistant could not undo its change:', error);
      toast.error(t('assistant.change.undoFailed'));
    } finally {
      setAnnullamento(false);
    }
  }, [modello, modifica, parameterService, t]);

  const chiudiModifica = useCallback(() => {
    setModifica(undefined);
  }, []);

  const selezionaPezzo = useCallback(
    (nome: string) => {
      for (const id of units.unitOrder) {
        const unit = units.unitsById[id];
        const nodo = Object.values(unit?.manifest?.nodesById ?? {}).find(
          (candidato) => candidato.kind === 'part' && pieceNameKey(candidato.name) === pieceNameKey(nome),
        );
        if (unit && nodo) {
          modelInteractionRef.send({ type: 'selectComponent', unitId: id, componentId: nodo.id, source: 'chat' });
          return;
        }
      }
    },
    [modelInteractionRef, units.unitOrder, units.unitsById],
  );

  const value = useMemo<AssistantTrayValue>(
    () => ({
      modello,
      ...(sessione ? { sessione } : {}),
      ...(modifica ? { modifica } : {}),
      annullamento,
      ...(chipInCorso === undefined ? {} : { chipInCorso }),
      ...(varianteInApplicazione === undefined ? {} : { varianteInApplicazione }),
      apriVarianti,
      chiudiVarianti,
      scartaVariante,
      valutaInsiemi,
      usaVariante,
      applicaModifiche,
      annullaModifica,
      chiudiModifica,
      selezionaPezzo,
    }),
    [
      annullaModifica,
      annullamento,
      applicaModifiche,
      apriVarianti,
      chipInCorso,
      chiudiModifica,
      chiudiVarianti,
      modello,
      modifica,
      scartaVariante,
      selezionaPezzo,
      sessione,
      usaVariante,
      valutaInsiemi,
      varianteInApplicazione,
    ],
  );
  return <AssistantTrayContext.Provider value={value}>{children}</AssistantTrayContext.Provider>;
}

/** Grams with two decimals, as the Measures weigh the model. */
const numero = (valore: number, language: Language): string =>
  formatNumber(valore, language, { maximumFractionDigits: 2 });

/**
 * The variants of a worker's answer as the card shows them: name, reason, preview, the first differences in words
 * (derived measures follow and are left out), the weight and its change, the warning of a new blocking check.
 */
function carteVarianti(
  tray: AssistantTrayValue,
  esito: EsitoVarianti,
  opzioni: Readonly<{
    anteprime: ReadonlyMap<string, string>;
    scartate?: ReadonlySet<string>;
    t: Translate;
    language: Language;
  }>,
): VarianteCard[] {
  const { famiglia } = tray.modello;
  const { t, language } = opzioni;
  const derivati = new Set(
    famiglia?.definizione.parametri.flatMap((definizione) => (definizione.derivato ? [definizione.chiave] : [])),
  );
  const pesoAttuale = esito.attuale.pesoGrammi;
  return esito.varianti
    .filter((variante) => !opzioni.scartate?.has(variante.id))
    .map((variante, indice) => {
      const nome = variante.asse
        ? t(`assistant.variants.axes.${variante.asse}`)
        : (variante.titolo ?? `${t('assistant.variants.title')} ${indice + 1}`);
      const peso =
        pesoAttuale !== undefined && variante.pesoGrammi !== undefined && pesoAttuale > 0
          ? (() => {
              const percento = Math.round(((variante.pesoGrammi - pesoAttuale) / pesoAttuale) * 100);
              return {
                prima: `${numero(pesoAttuale, language)} g`,
                dopo: `${numero(variante.pesoGrammi, language)} g`,
                variazione: `${percento > 0 ? '+' : percento < 0 ? '−' : '±'}${Math.abs(percento)} %`,
              };
            })()
          : undefined;
      const anteprimaVariante = opzioni.anteprime.get(variante.id);
      return {
        id: variante.id,
        nome,
        ...(variante.motivo ? { motivo: variante.motivo } : {}),
        ...(anteprimaVariante ? { anteprima: anteprimaVariante } : {}),
        righe: famiglia
          ? variante.differenze
              .filter((differenza) => !derivati.has(differenza.chiave))
              .map((differenza) => rigaModifica(famiglia.definizione, differenza, language))
          : [],
        ...(peso ? { peso } : {}),
        ...(variante.nuoviBlocchi > 0 ? { avviso: t('assistant.variants.newBlock') } : {}),
      };
    });
}

const titoloVarianti = (tray: AssistantTrayValue, t: Translate): string => {
  const { famiglia } = tray.modello;
  return famiglia
    ? t('assistant.variants.ofFamily', {
        family: t('riconoscimento.title', {
          family: t(`riconoscimento.families.${famiglia.definizione.id}` as PlainMessageKey),
          variant: t(`riconoscimento.variants.${famiglia.variante}` as PlainMessageKey),
        }),
      })
    : t('assistant.variants.title');
};

/**
 * Whether «Annulla» can still run: only while the values are those the change wrote (or not yet updated).
 */
function statoAnnulla(tray: AssistantTrayValue, t: Translate): StatoAnnulla | undefined {
  const { modifica } = tray;
  if (!modifica) {
    return undefined;
  }
  if (tray.annullamento) {
    return { stato: 'in_corso' };
  }
  const { valori } = tray.modello;
  return uguali(valori, modifica.dopo) || uguali(valori, modifica.prima)
    ? {
        stato: 'pronto',
        onAnnulla: () => {
          void tray.annullaModifica();
        },
      }
    : { stato: 'non_disponibile', motivo: t('assistant.change.undoUnavailable') };
}

/** The chip's action: a change, the variants, the recognition's questions, or a draft for the composer. */
function useAzioneChip(): (chip: ChipAssistente) => void {
  const tray = useAssistantTray();
  const { setDraftText } = useDraftActions();
  const { focusComposer } = useAssistantComposer();
  return useCallback(
    (chip: ChipAssistente) => {
      switch (chip.tipo) {
        case 'modifica': {
          void tray?.applicaModifiche({ modifiche: chip.modifiche, sottotitolo: chip.titolo, chip: chip.id });
          return;
        }
        case 'varianti': {
          void tray?.apriVarianti();
          return;
        }
        case 'ipotesi': {
          // The recognition asks its questions one at a time in the inspector: go there when it is on screen.
          const domande = document.querySelector<HTMLElement>('[data-slot="inspector-recognition"]');
          if (domande) {
            domande.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            domande.querySelector<HTMLElement>('button, input')?.focus();
            return;
          }
          setDraftText(chip.bozza);
          focusComposer();
          return;
        }
        case 'scrivi': {
          setDraftText(chip.bozza);
          focusComposer();
        }
      }
    },
    [focusComposer, setDraftText, tray],
  );
}

/** The model's checks as the card shows them; none for a free model. */
const controlliDi = (modello: ModelloAssistente, language: Language): ControlliScheda | undefined => {
  const { controllo } = modello;
  switch (controllo.stato) {
    case 'nessuno': {
      return undefined;
    }
    case 'caricamento':
    case 'errore': {
      return { stato: controllo.stato };
    }
    case 'pronto': {
      return {
        stato: 'pronto',
        righe: controllo.esiti
          .toSorted((a, b) => (a.livello === b.livello ? 0 : a.livello === 'blocco' ? -1 : 1))
          .map((esito, indice) => ({
            id: `${esito.codice}-${esito.pezzo ?? ''}-${indice}`,
            testo: rigaEsito(esito, language),
            livello: esito.livello === 'blocco' ? 'blocco' : 'avviso',
            ...(esito.pezzo ? { pezzo: esito.pezzo } : {}),
          })),
      };
    }
  }
};

/** The model's card and next steps, from the tray. */
function useScheda():
  | Readonly<{
      scheda: ReturnType<typeof schedaModello>;
      controlli?: ControlliScheda;
      chips: ChipAssistente[];
    }>
  | undefined {
  const tray = useAssistantTray();
  const { language } = useTranslation();
  const modello = tray?.modello;
  // The rows of «Producibilità» come from the inspector's own checks; the worker's answer only feeds the next steps.
  const producibilita = useProducibilita();
  return useMemo(() => {
    if (!modello || modello.pieces.length === 0) {
      return undefined;
    }
    const { famiglia } = modello;
    const controllo = modello.controllo.stato === 'pronto' ? modello.controllo : undefined;
    const scheda = schedaModello({
      ...(famiglia ? { famiglia } : {}),
      pieces: modello.pieces,
      materials: modello.materials,
      ...(modello.riconoscimento?.iou === undefined ? {} : { iou: modello.riconoscimento.iou }),
      daFoto: modello.riconoscimento !== undefined,
      ipotesi: modello.ipotesi,
      nome: modello.nome,
      language,
    });
    const chips = chipsAssistente({
      ...(famiglia ? { famiglia } : {}),
      correzioni: controllo?.correzioni ?? [],
      esiti: controllo?.esiti ?? [],
      ipotesi: modello.ipotesi,
      language,
    });
    const controlli = !famiglia
      ? undefined
      : producibilita
        ? controlliDaProducibilita(producibilita, language)
        : controlliDi(modello, language);
    return { scheda, ...(controlli ? { controlli } : {}), chips };
  }, [language, modello, producibilita]);
}

/**
 * The card the assistant opens a model with (D4), in the empty conversation or the strip.
 *
 * @param props - Extra classes.
 * @returns The card, or nothing without a model.
 */
export function AssistantBrief({ className }: { readonly className?: string }): React.JSX.Element | undefined {
  const tray = useAssistantTray();
  const dati = useScheda();
  const azione = useAzioneChip();
  if (!tray || !dati) {
    return undefined;
  }
  return (
    <AssistantBriefCard
      className={className}
      scheda={dati.scheda}
      {...(dati.controlli ? { controlli: dati.controlli } : {})}
      chips={dati.chips}
      {...(tray.chipInCorso === undefined ? {} : { chipInCorso: tray.chipInCorso })}
      onChip={azione}
      onSelezionaPezzo={tray.selezionaPezzo}
    />
  );
}

/**
 * The next steps alone, as outline chips: under a conversation that has already started.
 *
 * @param props - Extra classes.
 * @returns The chips, or nothing without a model.
 */
export function AssistantNextSteps({ className }: { readonly className?: string }): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const dati = useScheda();
  const tray = useAssistantTray();
  const azione = useAzioneChip();
  if (!dati || dati.chips.length === 0) {
    return undefined;
  }
  return (
    <div role='group' aria-label={t('assistant.brief.nextSteps')} className={cn('flex flex-wrap gap-1.5', className)}>
      {dati.chips.map((chip) => (
        <Button
          key={chip.id}
          variant='outline'
          size='xs'
          disabled={tray?.chipInCorso !== undefined}
          className='h-auto min-h-7 max-w-full justify-start rounded-lg py-1 text-left leading-snug font-normal whitespace-normal'
          onClick={() => {
            azione(chip);
          }}
        >
          {chip.testo}
        </Button>
      ))}
    </div>
  );
}

/**
 * The variants asked with the chip, or «Cosa ho cambiato» after a change, whichever is open.
 *
 * @param props - Extra classes.
 * @returns The card, or nothing.
 */
export function AssistantTrayCard({ className }: { readonly className?: string }): React.JSX.Element | undefined {
  const { t, language } = useTranslation();
  const tray = useAssistantTray();
  if (!tray) {
    return undefined;
  }
  const { sessione, modifica } = tray;
  if (sessione) {
    const contenuto: ContenutoVarianti =
      sessione.stato === 'caricamento'
        ? { stato: 'caricamento' }
        : sessione.stato === 'errore'
          ? {
              stato: 'errore',
              messaggio: t('assistant.variants.error'),
              onRiprova: () => {
                void tray.apriVarianti();
              },
            }
          : sessione.esito.varianti.length === 0
            ? { stato: 'vuoto', messaggio: t('assistant.variants.empty') }
            : {
                stato: 'pronto',
                varianti: carteVarianti(tray, sessione.esito, {
                  anteprime: sessione.anteprime,
                  scartate: sessione.scartate,
                  t,
                  language,
                }),
              };
    return (
      <AssistantVariantsCard
        className={className}
        titolo={titoloVarianti(tray, t)}
        contenuto={contenuto}
        autoFocus
        {...(tray.varianteInApplicazione === undefined ? {} : { inApplicazione: tray.varianteInApplicazione })}
        onUsa={(id) => {
          const variante =
            sessione.stato === 'pronto' ? sessione.esito.varianti.find((voce) => voce.id === id) : undefined;
          const nome =
            contenuto.stato === 'pronto' ? contenuto.varianti.find((voce) => voce.id === id)?.nome : undefined;
          if (variante) {
            void tray.usaVariante(variante, nome ?? id);
          }
        }}
        onScarta={tray.scartaVariante}
        onChiudi={tray.chiudiVarianti}
      />
    );
  }
  if (modifica) {
    const annulla = statoAnnulla(tray, t);
    return (
      <AssistantChangeCard
        key={modifica.id}
        className={className}
        titolo={t('assistant.change.title')}
        sottotitolo={modifica.sottotitolo}
        righe={modifica.righe}
        {...(annulla ? { annulla } : {})}
        onChiudi={tray.chiudiModifica}
        onSelezionaPezzo={(riga) => {
          if (riga.pezzo) {
            tray.selezionaPezzo(riga.pezzo);
          }
        }}
      />
    );
  }
  return undefined;
}

/**
 * What the assistant shows above its composer: the open card (variants or a change), then the next steps for the
 * whole model or the selection's suggestions. On an empty conversation about a model the card of the model is the
 * conversation's own first word, so no steps repeat here.
 *
 * @param props - Extra classes.
 * @returns The footer.
 */
export function AssistantFooter({ className }: { readonly className?: string }): React.JSX.Element {
  const tray = useAssistantTray();
  const { selection } = useInspectorSelection();
  const hasMessages = useChatSelector((state) => state.messageOrder.length > 0);
  const isModel = selection.kind === 'model';
  const card = <AssistantTrayCard />;
  return (
    <div className={cn('space-y-2 empty:hidden', className)} data-slot='assistant-footer'>
      {card}
      {!isModel || !tray ? <AssistantContextChips /> : hasMessages && !tray.sessione ? <AssistantNextSteps /> : null}
    </div>
  );
}

/** Where the agent's sets stand in the worker. */
type StatoAgente =
  | Readonly<{ stato: 'caricamento' }>
  | Readonly<{ stato: 'errore' }>
  | Readonly<{
      stato: 'pronto';
      esito: EsitoVarianti;
      anteprime: ReadonlyMap<string, string>;
      scartate: ReadonlySet<string>;
    }>;

/**
 * What the agent's card says: still streaming, a block that does not apply to this model, the worker's progress or
 * failure, or the variants.
 */
function contenutoAgente(
  tray: AssistantTrayValue,
  ingresso: Readonly<{
    blocco: BloccoVarianti;
    stato: StatoAgente;
    onRiprova: () => void;
    t: Translate;
    language: Language;
  }>,
): ContenutoVarianti {
  const { blocco, stato, t, language } = ingresso;
  const { famiglia } = tray.modello;
  if (blocco.stato === 'in_corso') {
    return { stato: 'caricamento', messaggio: t('assistant.variants.streaming') };
  }
  if (blocco.stato === 'non_valido') {
    return { stato: 'vuoto', messaggio: t('assistant.variants.invalid') };
  }
  if (!famiglia) {
    return { stato: 'vuoto', messaggio: t('assistant.variants.notFamily') };
  }
  if (blocco.famiglia !== undefined && blocco.famiglia !== famiglia.definizione.id) {
    return {
      stato: 'vuoto',
      messaggio: t('assistant.variants.otherFamily', {
        family: t(`riconoscimento.families.${blocco.famiglia}` as PlainMessageKey),
      }),
    };
  }
  if (stato.stato === 'caricamento') {
    return { stato: 'caricamento' };
  }
  if (stato.stato === 'errore') {
    return { stato: 'errore', messaggio: t('assistant.variants.error'), onRiprova: ingresso.onRiprova };
  }
  return stato.esito.varianti.length === 0
    ? { stato: 'vuoto', messaggio: t('assistant.variants.emptyAgent') }
    : {
        stato: 'pronto',
        varianti: carteVarianti(tray, stato.esito, {
          anteprime: stato.anteprime,
          scartate: stato.scartate,
          t,
          language,
        }),
      };
}

/**
 * The agent's own variants in an answer (D5): evaluated in the worker on this model, inside its family's limits, and
 * applied only with «Usa questa». While the answer streams the card waits; an unreadable block or another family
 * says so.
 *
 * @param props - The block read from the answer.
 * @returns The card.
 */
export function AgentVariantsBlock({ blocco }: Readonly<{ blocco: BloccoVarianti }>): React.JSX.Element | undefined {
  const { t, language } = useTranslation();
  const tray = useAssistantTray();
  const [stato, setStato] = useState<StatoAgente>({ stato: 'caricamento' });
  const [chiuso, setChiuso] = useState(false);
  const [giro, setGiro] = useState(0);
  const famiglia = tray?.modello.famiglia;
  const insiemi = blocco.stato === 'pronto' ? blocco.insiemi : undefined;
  const stessaFamiglia =
    blocco.stato === 'pronto' && (blocco.famiglia === undefined || blocco.famiglia === famiglia?.definizione.id);
  const valutaInsiemi = tray?.valutaInsiemi;
  const impronta = insiemi && famiglia && stessaFamiglia ? JSON.stringify([insiemi, famiglia.parametri]) : '';
  useEffect(() => {
    if (impronta === '' || !valutaInsiemi || !insiemi) {
      return undefined;
    }
    const corsa: { viva: boolean; anteprime?: ReadonlyMap<string, string> } = { viva: true };
    // async-iife: bootstrap -- the block arrived: its sets are checked once per answer and per model.
    void (async (): Promise<void> => {
      try {
        const esito = await valutaInsiemi(insiemi);
        corsa.anteprime = urlAnteprime(esito);
        if (corsa.viva) {
          setStato({ stato: 'pronto', esito, anteprime: corsa.anteprime, scartate: new Set() });
        } else {
          revoca(corsa.anteprime);
        }
      } catch (error) {
        // `giro` counts the «Riprova» presses: it is what restarts this check, so the failure names it.
        console.error('The assistant’s variants could not be evaluated:', error, { giro });
        if (corsa.viva) {
          setStato({ stato: 'errore' });
        }
      }
    })();
    return () => {
      corsa.viva = false;
      revoca(corsa.anteprime);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint stands for the sets and the model's values.
  }, [impronta, giro, valutaInsiemi]);
  if (!tray || chiuso) {
    return undefined;
  }
  const contenuto = contenutoAgente(tray, {
    blocco,
    stato,
    t,
    language,
    onRiprova: () => {
      setStato({ stato: 'caricamento' });
      setGiro((attuale) => attuale + 1);
    },
  });
  const usa = async (id: string): Promise<void> => {
    const variante = stato.stato === 'pronto' ? stato.esito.varianti.find((voce) => voce.id === id) : undefined;
    const nome = contenuto.stato === 'pronto' ? contenuto.varianti.find((voce) => voce.id === id)?.nome : undefined;
    if (variante) {
      setChiuso(await tray.usaVariante(variante, nome ?? id));
    }
  };
  return (
    <AssistantVariantsCard
      className='my-2'
      titolo={titoloVarianti(tray, t)}
      daAgente
      contenuto={contenuto}
      {...(tray.varianteInApplicazione === undefined ? {} : { inApplicazione: tray.varianteInApplicazione })}
      onUsa={(id) => {
        void usa(id);
      }}
      onScarta={(id) => {
        if (stato.stato !== 'pronto') {
          return;
        }
        const scartate = new Set([...stato.scartate, id]);
        if (stato.esito.varianti.every((voce) => scartate.has(voce.id))) {
          setChiuso(true);
          return;
        }
        setStato({ ...stato, scartate });
      }}
      onChiudi={() => {
        setChiuso(true);
      }}
    />
  );
}
