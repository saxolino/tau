/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';
import type { Esito, PezzoFamiglia } from '#famiglie/famiglia.js';

/**
 * Misure riusabili delle verifiche di producibilità (specifica §1.10): parete minima per raggi, sformo, solido
 * chiuso, peso, normalizzazione dei pezzi e rilettura dello STEP. Tutte sopra la libreria passata (nessun import
 * di valore di `@classcad/smlibwasm`: il worker passa la propria).
 */

type Lib = typeof Smlib;
type Punto = readonly [number, number, number];

/**
 * Un esito di verifica.
 * @param livello - ok, avviso, blocco o info.
 * @param codice - Codice stabile (`PARETE_MIN`…).
 * @param dettagli - Testo in italiano per il pannello Verifiche, o il testo con pezzo, valore misurato e soglia.
 * @returns L'esito.
 */
export const esito = (
  livello: Esito['livello'],
  codice: string,
  dettagli: string | (Pick<Esito, 'messaggio'> & Partial<Pick<Esito, 'pezzo' | 'valore' | 'soglia'>>),
): Esito => ({ livello, codice, ...(typeof dettagli === 'string' ? { messaggio: dettagli } : dettagli) });

/** Formattazione italiana dei millimetri per i messaggi. */
export const mm = (valore: number, decimali = 2): string =>
  `${valore.toLocaleString('it-IT', { maximumFractionDigits: decimali, minimumFractionDigits: 0 })} mm`;

/**
 * Esito di una soglia minima: blocco sotto `fattoreBlocco × soglia`, avviso sotto la soglia, ok sopra.
 * @param codice - Codice della verifica.
 * @param misura - Valore misurato, minimo ammesso, che cosa si misura (per il messaggio), pezzo e fattore di blocco
 *   (default 0,8; 0 = mai blocco).
 * @returns L'esito.
 */
export function esitoMinimo(
  codice: string,
  misura: { valore: number; soglia: number; cosa: string; pezzo?: string; fattoreBlocco?: number },
): Esito {
  const { valore, soglia, cosa, ...extra } = misura;
  const fattore = extra.fattoreBlocco ?? 0.8;
  const base = { valore, soglia, ...(extra.pezzo ? { pezzo: extra.pezzo } : {}) };
  if (valore + 1e-9 >= soglia) {
    return esito('ok', codice, { messaggio: `${cosa}: ${mm(valore)} (minimo ${mm(soglia)}).`, ...base });
  }
  if (valore < fattore * soglia) {
    return esito('blocco', codice, { messaggio: `${cosa} ${mm(valore)}: sotto il minimo di ${mm(soglia)}.`, ...base });
  }
  return esito('avviso', codice, {
    messaggio: `${cosa} ${mm(valore)}: al limite, il minimo è ${mm(soglia)}.`,
    ...base,
  });
}

/**
 * Riporta un corpo nella forma nativa del kernel (`fromSmb(toSmb())`), il rimedio obbligatorio dopo le booleane.
 * @param lib - Libreria SMLib.
 * @param forma - Corpo appena costruito.
 * @returns Il corpo riletto, o quello di partenza se la rilettura non dà un solido.
 */
export function normalizzaForma(lib: Lib, forma: Smlib.Part): Smlib.Part {
  // Binario: lo stesso corpo, venti volte più veloce del testo su un tacco svuotato (≈ 3 ms contro 56 ms).
  const riletta = lib.fromSmb(lib.toSmb(forma, { ascii: false }));
  return riletta instanceof lib.Part ? riletta : forma;
}

/**
 * Solido chiuso: valido per il kernel e fatto di un solo corpo.
 * @param lib - Libreria SMLib.
 * @param forma - Forma da controllare.
 * @returns True se chiuso e in un pezzo.
 */
export function solidoChiuso(lib: Lib, forma: unknown): boolean {
  return forma instanceof lib.Part && forma.isValid() && forma.solids().length === 1;
}

/**
 * Peso in grammi per una densità in g/cm³ (il kernel vuole g/mm³: densità / 1000).
 * @param forma - Solido.
 * @param densitaGcm3 - Densità in g/cm³.
 * @returns Grammi.
 */
export const pesoGrammi = (forma: Smlib.Part, densitaGcm3: number): number =>
  forma.massProperties(densitaGcm3 / 1000).mass;

/** Facce del corpo vicine a punti dati: ritrova un insieme di facce dopo una rilettura o uno specchio. */
export function facceAiPunti(forma: Smlib.Part, punti: readonly Punto[], tolleranza = 1e-4): Smlib.Face[] {
  const facce = [...forma.faces()];
  return facce.filter((faccia) => punti.some((punto) => faccia.distanceTo(punto) < tolleranza));
}

/** Un punto interno di ogni faccia, per ritrovarle con `facceAiPunti`. */
export const puntiDiFacce = (facce: Iterable<Smlib.Face>): Punto[] =>
  [...facce].map((faccia) => faccia.interiorPoint().toArray());

/** Marcatori di facce per pezzo (cavità, fianchi del testo…), tenuti fuori dalla configurazione del kernel. */
const marcatori = new WeakMap<WeakKey, Record<string, Punto[]>>();

/**
 * Associa a una forma i punti che individuano un gruppo di sue facce.
 * @param forma - Corpo del pezzo (dopo la normalizzazione).
 * @param nome - Nome del gruppo (`cavita`).
 * @param punti - Punti sulle facce.
 */
export function marcaFacce(forma: WeakKey, nome: string, punti: readonly Punto[]): void {
  const esistenti = marcatori.get(forma) ?? {};
  marcatori.set(forma, { ...esistenti, [nome]: [...punti] });
}

/**
 * I punti di un gruppo di facce marcato su una forma.
 * @param forma - Corpo del pezzo.
 * @param nome - Nome del gruppo.
 * @returns I punti, o undefined se il gruppo non c'è.
 */
export const puntiMarcati = (forma: WeakKey, nome: string): Punto[] | undefined => marcatori.get(forma)?.[nome];

/**
 * Copia i marcatori di una forma su un'altra trasformando i punti (specchio, traslazione).
 * @param da - Forma di partenza.
 * @param a - Forma trasformata.
 * @param trasforma - Trasformazione dei punti.
 */
export function trasportaMarcatori(da: WeakKey, a: WeakKey, trasforma: (punto: Punto) => Punto): void {
  const origine = marcatori.get(da);
  if (origine) {
    marcatori.set(
      a,
      Object.fromEntries(
        Object.entries(origine).map(([nome, punti]) => [nome, punti.map((punto) => trasforma(punto))]),
      ),
    );
  }
}

/** Esito della misura della parete: il minimo e dove sta. */
export type MisuraParete = { min: number; dove?: Punto; campioni: number };

/**
 * Parete minima per raggi: da punti sulle facce, un raggio verso l'interno del materiale (lungo −normale) fino
 * all'uscita dal solido. Campioni: il punto interno di ogni faccia e fino a `campioniPerFaccia − 1` baricentri dei
 * triangoli della sua tessellazione (presi a passo regolare e proiettati sulla faccia: deterministico).
 * @param forma - Solido.
 * @param opzioni - Facce da cui partire (default tutte) e campioni per faccia (default 8).
 * @returns Il minimo misurato.
 */
export function pareteMinima(
  forma: Smlib.Part,
  opzioni: { facce?: Iterable<Smlib.Face>; campioniPerFaccia?: number } = {},
): MisuraParete {
  const campioniPerFaccia = Math.max(1, opzioni.campioniPerFaccia ?? 8);
  const origini: Punto[] = [];
  const direzioni: Punto[] = [];
  const scostamento = 0.01;
  for (const faccia of opzioni.facce ?? forma.faces()) {
    const punti = [faccia.interiorPoint()];
    if (campioniPerFaccia > 1) {
      const maglia = faccia.mesh();
      const triangoli = maglia.triangles.length / 3;
      const passo = Math.max(1, Math.floor(triangoli / (campioniPerFaccia - 1)));
      for (let indice = 0; indice < triangoli && punti.length < campioniPerFaccia; indice += passo) {
        const baricentro = [0, 1, 2].map((asse) => {
          let somma = 0;
          for (let angolo = 0; angolo < 3; angolo++) {
            somma += maglia.vertices[maglia.triangles[indice * 3 + angolo]! * 3 + asse]!;
          }
          return somma / 3;
        });
        punti.push(faccia.closestPoint(baricentro));
      }
    }
    for (const punto of punti) {
      const normale = faccia.normalAt(punto);
      origini.push(punto.sub(normale.mul(scostamento)).toArray());
      direzioni.push(normale.neg().toArray());
    }
  }
  if (origini.length === 0) {
    return { min: Number.POSITIVE_INFINITY, campioni: 0 };
  }
  const colpi = forma.raycastMany(origini, direzioni);
  let minimo = Number.POSITIVE_INFINITY;
  let dove: Punto | undefined;
  for (const [indice, colpo] of colpi.entries()) {
    if (colpo && colpo.distance > 1e-3) {
      const spessore = colpo.distance + scostamento;
      if (spessore < minimo) {
        minimo = spessore;
        dove = origini[indice];
      }
    }
  }
  return { min: minimo, campioni: origini.length, ...(dove ? { dove } : {}) };
}

/** Facce raggruppate per sformo rispetto a una direzione di estrazione. */
export type MisuraSformo = {
  positive: Smlib.Face[];
  insufficienti: Smlib.Face[];
  verticali: Smlib.Face[];
  sottosquadri: Smlib.Face[];
  /** Il minimo angolo di sformo fra le facce considerate (gradi; negativo = sottosquadro). */
  minimo: number;
};

const nellInsieme = (faccia: Smlib.Face, insieme: readonly Smlib.Face[] | undefined): boolean =>
  insieme === undefined || insieme.some((altra) => altra.equals(faccia));

const raggruppa = (analisi: Iterable<Smlib.FaceDraft>, filtro: (draft: Smlib.FaceDraft) => boolean): MisuraSformo => {
  const misura: MisuraSformo = { positive: [], insufficienti: [], verticali: [], sottosquadri: [], minimo: 90 };
  for (const draft of analisi) {
    if (!filtro(draft)) {
      continue;
    }
    misura.minimo = Math.min(misura.minimo, draft.minAngle);
    switch (draft.kind) {
      case 'positive': {
        misura.positive.push(draft.face);

        break;
      }
      case 'insufficient': {
        misura.insufficienti.push(draft.face);

        break;
      }
      case 'vertical': {
        misura.verticali.push(draft.face);

        break;
      }
      default: {
        misura.sottosquadri.push(draft.face);
      }
    }
  }
  return misura;
};

/**
 * Sformo rispetto a una direzione di estrazione (wrapper di `draftAnalysis`), anche solo su alcune facce.
 * @param forma - Solido.
 * @param opzioni - Direzione in cui lo stampo si stacca dal pezzo, sformo minimo (gradi), facce da considerare
 *   (default tutte).
 * @returns Facce per gruppo e angolo minimo.
 */
export function sformo(
  forma: Smlib.Part,
  opzioni: { direzione: Punto; minimo: number; facce?: readonly Smlib.Face[] },
): MisuraSformo {
  const { direzione, minimo, facce } = opzioni;
  return raggruppa(forma.draftAnalysis(direzione, { minAngle: minimo }), (draft) => nellInsieme(draft.face, facce));
}

/**
 * Sformo per uno stampo a due semistampi con piano di divisione orizzontale a `zPiano`: le facce sopra il piano
 * si estraggono verso +Z, quelle sotto verso −Z, quelle sul piano (la divisione) non contano; una faccia che
 * attraversa il piano conta col peggiore dei due versi.
 * @param forma - Solido.
 * @param opzioni - Quota del piano di divisione, sformo minimo (gradi), facce da considerare (default tutte).
 * @returns Facce per gruppo e angolo minimo.
 */
export function sformoDuePiani(
  forma: Smlib.Part,
  opzioni: { piano: number; minimo: number; facce?: readonly Smlib.Face[] },
): MisuraSformo {
  const { piano: zPiano, minimo, facce } = opzioni;
  const tolleranza = 1e-4;
  const su = [...forma.draftAnalysis([0, 0, 1], { minAngle: minimo })];
  const giu = [...forma.draftAnalysis([0, 0, -1], { minAngle: minimo })];
  const scelte: Smlib.FaceDraft[] = [];
  for (const [indice, draftSu] of su.entries()) {
    const draftGiu = giu[indice]?.face.equals(draftSu.face)
      ? giu[indice]
      : (giu.find((candidato) => candidato.face.equals(draftSu.face)) ?? draftSu);
    const { min, max } = draftSu.face.bbox();
    const sopra = min.z >= zPiano - tolleranza;
    const sotto = max.z <= zPiano + tolleranza;
    if (sopra && sotto) {
      continue;
    }
    if (sopra) {
      scelte.push(draftSu);
    } else if (sotto) {
      scelte.push(draftGiu);
    } else {
      scelte.push(draftSu.minAngle <= draftGiu.minAngle ? draftSu : draftGiu);
    }
  }
  return raggruppa(scelte, (draft) => nellInsieme(draft.face, facce));
}

/**
 * Esiti di sformo e sottosquadro da una misura: sottosquadri = blocco, insufficienti e verticali = avviso.
 * @param misura - Misura dello sformo.
 * @param contesto - Sformo minimo (gradi), nome del pezzo, descrizione delle facce per il messaggio.
 * @returns Esiti `SFORMO` e `SOTTOSQUADRO`.
 */
export function esitiSformo(misura: MisuraSformo, contesto: { soglia: number; pezzo: string; dove: string }): Esito[] {
  const { soglia, pezzo, dove } = contesto;
  const esiti: Esito[] = [];
  if (misura.sottosquadri.length > 0) {
    esiti.push(
      esito('blocco', 'SOTTOSQUADRO', {
        messaggio: `${dove}: ${misura.sottosquadri.length} facce in sottosquadro: serve un carrello o un altro piano di divisione.`,
        pezzo,
        valore: misura.minimo,
        soglia,
      }),
    );
  }
  const scarse = misura.insufficienti.length + misura.verticali.length;
  esiti.push(
    scarse > 0
      ? esito('avviso', 'SFORMO', {
          messaggio: `${dove}: ${scarse} facce con sformo sotto ${soglia}° (${misura.verticali.length} a 0°).`,
          pezzo,
          valore: Math.max(0, misura.minimo),
          soglia,
        })
      : esito('ok', 'SFORMO', {
          messaggio: `${dove}: sformo almeno ${soglia}° su tutte le facce.`,
          pezzo,
          valore: misura.minimo,
          soglia,
        }),
  );
  return esiti;
}

/**
 * Esiti comuni a ogni pezzo: solido chiuso e peso informativo.
 * @param lib - Libreria SMLib.
 * @param pezzi - Pezzi della famiglia.
 * @returns Un `SOLIDO_CHIUSO` per pezzo e un `PESO` per pezzo e totale.
 */
export function esitiPezzi(lib: Lib, pezzi: readonly PezzoFamiglia[]): Esito[] {
  const esiti: Esito[] = [];
  let totale = 0;
  for (const pezzo of pezzi) {
    const chiuso = solidoChiuso(lib, pezzo.shape);
    esiti.push(
      chiuso
        ? esito('ok', 'SOLIDO_CHIUSO', { messaggio: `${pezzo.name}: solido chiuso in un pezzo.`, pezzo: pezzo.name })
        : esito('blocco', 'SOLIDO_CHIUSO', {
            messaggio: `${pezzo.name}: il solido non è chiuso o è in più pezzi.`,
            pezzo: pezzo.name,
          }),
    );
    if (pezzo.shape instanceof lib.Part && typeof pezzo.density === 'number') {
      const grammi = pesoGrammi(pezzo.shape, pezzo.density);
      totale += grammi;
      esiti.push(
        esito('info', 'PESO', {
          messaggio: `${pezzo.name}: ${grammi.toLocaleString('it-IT', { maximumFractionDigits: 2 })} g.`,
          pezzo: pezzo.name,
          valore: grammi,
        }),
      );
    }
  }
  if (pezzi.length > 1) {
    esiti.push(
      esito('info', 'PESO', {
        messaggio: `Totale: ${totale.toLocaleString('it-IT', { maximumFractionDigits: 2 })} g.`,
        valore: totale,
      }),
    );
  }
  return esiti;
}

/** Un corpo riletto dallo STEP. */
export type CorpoStep = { nome: string | undefined; volume: number; valido: boolean };

/**
 * Scrive i pezzi in STEP (un prodotto per pezzo, col suo nome) e li rilegge: stesso numero di corpi, volumi entro
 * 1e-4 relativo, nomi conservati.
 * @param lib - Libreria SMLib.
 * @param pezzi - Pezzi della famiglia.
 * @param nome - Nome dell'assieme.
 * @returns Il testo STEP, i corpi riletti e l'esito `STEP_RILETTO`.
 * @public
 */
export function rileggiStep(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  nome: string,
): { step: string; corpi: CorpoStep[]; esito: Esito } {
  const corpi = pezzi.flatMap((pezzo) => (pezzo.shape instanceof lib.Part ? [pezzo.shape.named(pezzo.name)] : []));
  const step = lib.toStep(corpi, { assembly: true, name: nome });
  const letti = lib.fromStep(step);
  const elenco = (letti instanceof lib.Shape ? [letti] : [...letti]) as Array<Smlib.Part | Smlib.Shell>;
  const riletti: CorpoStep[] = elenco.map((corpo) => ({
    nome: corpo.name ?? undefined,
    volume: corpo instanceof lib.Part ? corpo.volume : 0,
    valido: corpo instanceof lib.Part && corpo.isValid(),
  }));
  const problemi: string[] = [];
  if (riletti.length !== corpi.length) {
    problemi.push(`${riletti.length} corpi riletti su ${corpi.length}`);
  }
  for (const corpo of corpi) {
    const letto = riletti.find((candidato) => candidato.nome === corpo.name);
    if (!letto) {
      problemi.push(`${corpo.name ?? 'senza nome'} non ritrovato`);
    } else if (!letto.valido || Math.abs(letto.volume - corpo.volume) > 1e-4 * Math.max(1, corpo.volume)) {
      problemi.push(`${corpo.name ?? 'senza nome'} cambiato nella rilettura`);
    }
  }
  return {
    step,
    corpi: riletti,
    esito:
      problemi.length === 0
        ? esito('ok', 'STEP_RILETTO', `STEP riletto: ${riletti.length} pezzi con nomi e volumi uguali.`)
        : esito('blocco', 'STEP_RILETTO', `STEP: ${problemi.join('; ')}.`),
  };
}
