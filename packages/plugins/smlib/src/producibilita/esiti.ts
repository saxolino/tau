import type { Esito, Processo } from '#famiglie/famiglia.js';
import { sogliaParete, sogliaSformo, soglieProcessi } from '#famiglie/processi.js';
import { esitoMinimo, mm } from '#famiglie/verifiche-comuni.js';
import type {
  ControlloProducibilita,
  MisureModello,
  MisurePezzo,
  PezzoRichiesto,
  SformoFaccia,
} from '#producibilita/tipi.js';

/**
 * I controlli di producibilità (E1) dalle misure e dalle soglie del processo: funzione pura, senza kernel. La usano il
 * worker, l'ispettore (che la ricalcola subito quando cambia il processo) e l'assistente. Codici e livelli sono quelli
 * delle verifiche delle famiglie (`PARETE_MIN`, `SFORMO`, `SOTTOSQUADRO`, `SOLIDO_CHIUSO`…), così le due fonti si
 * fondono in una riga per codice e pezzo.
 */

/**
 * Codici dei controlli misurati sulla geometria, nell'ordine in cui l'ispettore li mostra.
 * @public
 */
export const codiciGeometrici = [
  'SOLIDO_CHIUSO',
  'PARETE_MIN',
  'SFORMO',
  'SOTTOSQUADRO',
  'FORO_MIN',
  'GRIFFA_BASE',
  'GRIFFA_ALTEZZA',
] as const;

/**
 * Quanto una griffa deve salire sopra la cintura per essere ribattuta sulla pietra (mm, mestiere: il minimo di
 * `griffe.altezzaSopraCintura` della famiglia anello).
 * @public
 */
export const griffaSopraCinturaMinima = 0.5;

/** Codici delle famiglie che l'ispettore non ripete (il peso sta nelle Misure). */
const codiciEsclusi = new Set(['PESO']);

const pesoLivello: Readonly<Record<Esito['livello'], number>> = { blocco: 3, avviso: 2, ok: 1, info: 0 };

/**
 * Il più grave di due livelli.
 * @param a - Un livello.
 * @param b - L'altro.
 * @returns Il più grave.
 * @public
 */
export const livelloPeggiore = (a: Esito['livello'], b: Esito['livello']): Esito['livello'] =>
  pesoLivello[a] >= pesoLivello[b] ? a : b;

const tolleranzaAngolo = 1e-6;

type VoceFaccia = Readonly<{ faccia: number; livello: 'avviso' | 'blocco' }>;

/** Una faccia da evidenziare: blocco sotto il limite di blocco, avviso sotto la soglia. */
const voce = (faccia: number, valore: number, limiteBlocco: number): VoceFaccia => ({
  faccia,
  livello: valore < limiteBlocco ? 'blocco' : 'avviso',
});

/**
 * Lo sformo di una faccia nella metà dello stampo da cui si stacca (gradi, ≥ 0), o undefined se la faccia sta a
 * cavallo del piano di divisione (una sfera, un perno orizzontale: il piano la taglia dove lo sformo è nullo).
 * @param sformo - Minimo e massimo angolo verso `+d`.
 * @returns Gradi o undefined.
 * @public
 */
export function sformoUtile(sformo: SformoFaccia): number | undefined {
  if (sformo.min >= -tolleranzaAngolo) {
    return Math.max(0, sformo.min);
  }
  if (sformo.max <= tolleranzaAngolo) {
    return Math.max(0, -sformo.max);
  }
  return undefined;
}

const gradi = (valore: number): string =>
  `${valore.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 0 })}°`;

type Contesto = { pezzo: string; processo: Processo; materiale?: string };

const controllo = (
  base: Esito,
  extra: Omit<Partial<ControlloProducibilita>, keyof Esito | 'id' | 'fonti'> = {},
): ControlloProducibilita => ({
  ...base,
  ...extra,
  id: `${base.codice}|${base.pezzo ?? ''}`,
  fonti: ['geometria'],
});

function solidoChiuso(misure: MisurePezzo): ControlloProducibilita {
  const { nome } = misure;
  if (misure.stato === 'chiuso') {
    return controllo({ livello: 'ok', codice: 'SOLIDO_CHIUSO', pezzo: nome, messaggio: `${nome}: solido chiuso.` });
  }
  return controllo(
    {
      livello: 'blocco',
      codice: 'SOLIDO_CHIUSO',
      pezzo: nome,
      messaggio:
        misure.stato === 'piu_corpi'
          ? `${nome}: il pezzo è fatto di più solidi separati.`
          : `${nome}: il solido non è chiuso, non si può fondere né stampare.`,
    },
    { evidenza: 'pezzo' },
  );
}

function pareteMinima(misure: MisurePezzo, { pezzo, processo, materiale }: Contesto): ControlloProducibilita {
  const soglia = sogliaParete(processo, materiale);
  const locale = soglieProcessi[processo].pareteMinimaLocale;
  const limiteBlocco = locale ?? 0.8 * soglia;
  const valore = Number.isFinite(misure.spessoreMinimo) ? misure.spessoreMinimo : soglia;
  const esito = esitoMinimo('PARETE_MIN', {
    valore,
    soglia,
    cosa: 'Parete minima',
    pezzo,
    fattoreBlocco: limiteBlocco / soglia,
  });
  const facce = misure.spessori.flatMap((spessore, faccia) =>
    spessore + 1e-9 < soglia ? [voce(faccia, spessore, limiteBlocco)] : [],
  );
  return controllo(esito, { unita: 'mm', evidenza: 'facce', facce, conteggio: facce.length });
}

function sformoESottosquadri(misure: MisurePezzo, contesto: Contesto): ControlloProducibilita[] {
  const { pezzo, processo, materiale } = contesto;
  const soglie = soglieProcessi[processo];
  const soglia = sogliaSformo(processo, materiale);
  const controlli: ControlloProducibilita[] = [];
  const intrappolate = new Set(misure.intrappolate);
  if (soglia !== undefined) {
    let minimo = 90;
    const scarse: number[] = [];
    let verticali = 0;
    for (const [faccia, sformo] of misure.sformi.entries()) {
      const utile = intrappolate.has(faccia) ? undefined : sformoUtile(sformo);
      if (utile === undefined) {
        continue;
      }
      minimo = Math.min(minimo, utile);
      if (utile + 1e-6 < soglia) {
        scarse.push(faccia);
        if (utile < 1e-3) {
          verticali++;
        }
      }
    }
    controlli.push(
      controllo(
        scarse.length > 0
          ? {
              livello: 'avviso',
              codice: 'SFORMO',
              pezzo,
              valore: minimo,
              soglia,
              messaggio: `${pezzo}: ${scarse.length} facce con sformo sotto ${gradi(soglia)} (${verticali} a 0°).`,
            }
          : {
              livello: 'ok',
              codice: 'SFORMO',
              pezzo,
              valore: minimo,
              soglia,
              messaggio: `${pezzo}: sformo almeno ${gradi(soglia)} su tutte le facce.`,
            },
        {
          unita: 'deg',
          evidenza: 'sformo',
          facce: scarse.map((faccia) => voce(faccia, soglia, 0)),
          conteggio: scarse.length,
        },
      ),
    );
  }
  if (soglie.sottosquadro !== 'libero') {
    const livello = soglie.sottosquadro;
    const quante = intrappolate.size;
    controlli.push(
      controllo(
        quante > 0
          ? {
              livello,
              codice: 'SOTTOSQUADRO',
              pezzo,
              valore: quante,
              messaggio:
                livello === 'blocco'
                  ? `${pezzo}: ${quante} facce in sottosquadro: serve un carrello o un altro piano di divisione.`
                  : `${pezzo}: ${quante} facce non raggiungibili lungo l’asse: serve un altro piazzamento o una fresa a T.`,
            }
          : { livello: 'ok', codice: 'SOTTOSQUADRO', pezzo, valore: 0, messaggio: `${pezzo}: nessun sottosquadro.` },
        {
          unita: 'n',
          evidenza: soglia === undefined ? 'facce' : 'sformo',
          facce: [...intrappolate].map((faccia) => ({ faccia, livello })),
          conteggio: quante,
        },
      ),
    );
  }
  return controlli;
}

function foriMinimi(misure: MisurePezzo, { pezzo, processo }: Contesto): ControlloProducibilita[] {
  const soglia = soglieProcessi[processo].foroMinimo;
  if (soglia === undefined || misure.fori.length === 0) {
    return [];
  }
  const minimo = Math.min(...misure.fori.map(({ diametro }) => diametro));
  const esito = esitoMinimo('FORO_MIN', { valore: minimo, soglia, cosa: 'Foro più piccolo ⌀', pezzo });
  const facce = misure.fori.flatMap(({ facce: delForo, diametro }) =>
    diametro + 1e-9 < soglia ? delForo.map((faccia) => voce(faccia, diametro, 0.8 * soglia)) : [],
  );
  return [controllo(esito, { unita: 'mm', evidenza: 'facce', facce, conteggio: misure.fori.length })];
}

function griffe(misure: MisurePezzo, { pezzo, processo }: Contesto): ControlloProducibilita[] {
  if (misure.griffe.length === 0) {
    return [];
  }
  const controlli: ControlloProducibilita[] = [];
  const soglia = soglieProcessi[processo].griffaMinima;
  if (soglia !== undefined) {
    const minimo = Math.min(...misure.griffe.map(({ diametro }) => diametro));
    const facce = misure.griffe.flatMap(({ facce: dellaGriffa, diametro }) =>
      diametro + 1e-9 < soglia ? dellaGriffa.map((faccia) => voce(faccia, diametro, 0.8 * soglia)) : [],
    );
    controlli.push(
      controllo(esitoMinimo('GRIFFA_BASE', { valore: minimo, soglia, cosa: 'Griffa più sottile ⌀', pezzo }), {
        unita: 'mm',
        evidenza: 'facce',
        facce,
        conteggio: misure.griffe.length,
      }),
    );
  }
  const altezza = Math.min(...misure.griffe.map(({ sopraCintura }) => sopraCintura));
  const soglia2 = griffaSopraCinturaMinima;
  const livello: Esito['livello'] = altezza <= 0 ? 'blocco' : altezza + 1e-9 < soglia2 ? 'avviso' : 'ok';
  const facce = misure.griffe.flatMap(({ facce: dellaGriffa, sopraCintura }) =>
    sopraCintura + 1e-9 < soglia2 ? dellaGriffa.map((faccia) => voce(faccia, sopraCintura, 1e-9)) : [],
  );
  controlli.push(
    controllo(
      {
        livello,
        codice: 'GRIFFA_ALTEZZA',
        pezzo,
        valore: altezza,
        soglia: soglia2,
        messaggio:
          livello === 'ok'
            ? `${pezzo}: le griffe salgono ${mm(altezza)} sopra la cintura (minimo ${mm(soglia2)}).`
            : livello === 'blocco'
              ? `${pezzo}: una griffa non arriva alla cintura della pietra: non la tiene.`
              : `${pezzo}: una griffa sale solo ${mm(altezza)} sopra la cintura: il minimo per ribatterla è ${mm(soglia2)}.`,
      },
      { unita: 'mm', evidenza: 'facce', facce, conteggio: misure.griffe.length },
    ),
  );
  return controlli;
}

/**
 * I controlli misurati di un pezzo per il suo processo e materiale. Un pezzo aperto ha solo `SOLIDO_CHIUSO`: le altre
 * misure su un guscio non vogliono dire niente. Le pietre non hanno controlli.
 * @param misure - Le misure del pezzo.
 * @param pezzo - Processo e materiale del pezzo.
 * @returns I controlli, nell'ordine di `codiciGeometrici`.
 * @public
 */
export function controlliPezzo(
  misure: MisurePezzo,
  pezzo: Pick<PezzoRichiesto, 'processo' | 'materiale'>,
): ControlloProducibilita[] {
  if (misure.pietra) {
    return [];
  }
  const chiuso = solidoChiuso(misure);
  if (misure.stato !== 'chiuso') {
    return [chiuso];
  }
  const contesto: Contesto = {
    pezzo: misure.nome,
    processo: pezzo.processo,
    ...(pezzo.materiale === undefined ? {} : { materiale: pezzo.materiale }),
  };
  return [
    chiuso,
    pareteMinima(misure, contesto),
    ...sformoESottosquadri(misure, contesto),
    ...foriMinimi(misure, contesto),
    ...griffe(misure, contesto),
  ];
}

/**
 * Fonde ai controlli misurati gli esiti di una famiglia: una riga per codice e pezzo, col livello più grave (e il suo
 * messaggio, valore e soglia), le facce della misura; gli esiti che la geometria non misura si aggiungono dopo quelli
 * del loro pezzo. Il peso resta nelle Misure.
 * @param controlli - I controlli misurati.
 * @param esitiFamiglia - Gli esiti della famiglia (costruzione e verifiche).
 * @returns I controlli uniti.
 * @public
 */
export function unisciEsiti(
  controlli: readonly ControlloProducibilita[],
  esitiFamiglia: readonly Esito[],
): ControlloProducibilita[] {
  const uniti = new Map<string, ControlloProducibilita>(controlli.map((riga) => [riga.id, riga]));
  for (const esito of esitiFamiglia) {
    if (codiciEsclusi.has(esito.codice)) {
      continue;
    }
    const id = `${esito.codice}|${esito.pezzo ?? ''}`;
    const presente = uniti.get(id);
    if (!presente) {
      uniti.set(id, { ...esito, id, fonti: ['famiglia'] });
      continue;
    }
    const peggiore = livelloPeggiore(esito.livello, presente.livello);
    const daFamiglia = peggiore !== presente.livello;
    const { valore, soglia } = daFamiglia ? esito : presente;
    uniti.set(id, {
      ...presente,
      livello: peggiore,
      messaggio: daFamiglia ? esito.messaggio : presente.messaggio,
      ...(valore === undefined ? {} : { valore }),
      ...(soglia === undefined ? {} : { soglia }),
      fonti: presente.fonti.includes('famiglia') ? presente.fonti : [...presente.fonti, 'famiglia'],
    });
  }
  const ordine = new Map(controlli.map((riga, indice) => [riga.pezzo ?? '', indice]));
  const posizione = (riga: ControlloProducibilita): number => ordine.get(riga.pezzo ?? '') ?? Number.MAX_SAFE_INTEGER;
  // Stabile: i controlli misurati restano nel loro ordine, gli altri vanno dopo il loro pezzo.
  return [...uniti.values()]
    .map((riga, indice) => ({ riga, indice }))
    .toSorted((a, b) => posizione(a.riga) - posizione(b.riga) || a.indice - b.indice)
    .map(({ riga }) => riga);
}

/**
 * Tutti i controlli di producibilità di un modello: quelli misurati per pezzo (col processo e il materiale di
 * ciascuno) e, se ci sono, quelli della famiglia, fusi.
 * @param misure - Le misure del modello.
 * @param pezzi - Processo e materiale per pezzo (per nome); un pezzo senza voce usa `processoPredefinito`.
 * @param opzioni - Gli esiti della famiglia e il processo dei pezzi senza voce (default cera persa).
 * @returns I controlli.
 * @public
 */
export function esitiProducibilita(
  misure: MisureModello,
  pezzi: readonly PezzoRichiesto[],
  opzioni: Readonly<{ esitiFamiglia?: readonly Esito[]; processoPredefinito?: Processo }> = {},
): ControlloProducibilita[] {
  const perNome = new Map(pezzi.map((pezzo) => [pezzo.nome, pezzo]));
  const controlli = misure.pezzi.flatMap((misurato) =>
    controlliPezzo(
      misurato,
      perNome.get(misurato.nome) ?? { processo: opzioni.processoPredefinito ?? 'fusione_cera_persa' },
    ),
  );
  return opzioni.esitiFamiglia?.length ? unisciEsiti(controlli, opzioni.esitiFamiglia) : controlli;
}

/**
 * Quanti blocchi, avvisi e controlli superati.
 * @param controlli - I controlli.
 * @returns I conteggi.
 * @public
 */
export function riepilogoProducibilita(controlli: readonly ControlloProducibilita[]): {
  blocchi: number;
  avvisi: number;
  ok: number;
} {
  return {
    blocchi: controlli.filter(({ livello }) => livello === 'blocco').length,
    avvisi: controlli.filter(({ livello }) => livello === 'avviso').length,
    ok: controlli.filter(({ livello }) => livello === 'ok').length,
  };
}
