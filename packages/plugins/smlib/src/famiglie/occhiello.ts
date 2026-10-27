/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';
import type { DefinizioneParametro, Esito, Famiglia, PezzoFamiglia, RisultatoCostruzione } from '#famiglie/famiglia.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import { aspettoMateriale } from '#famiglie/materiali.js';
import { limita, normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { esitiPezzi, esito, mm, normalizzaForma } from '#famiglie/verifiche-comuni.js';

/**
 * Famiglia `occhiello` (specifica §1.4): lamiera d'ottone imbutita, asse Z = asse del pezzo, flangia (testa) a
 * z = 0 verso +Z, gambo verso −Z dentro il materiale. Mezzo profilo a L sul piano XZ accanto all'asse, `revolve`.
 */

type Lib = typeof Smlib;

export type ParametriOcchiello = {
  foro: { diametro: number };
  flangia: { diametro: number; spessore: number; raggio: number };
  gambo: { altezza: number };
  parete: { spessore: number };
  rondella: { abilitata: boolean };
  costruzione: { materiale: 'ottone' | 'alluminio' };
};

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'foro.diametro',
    unita: 'mm',
    min: 3,
    max: 12,
    default: 5,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Diametro del foro',
  },
  {
    chiave: 'flangia.diametro',
    unita: 'mm',
    min: 6,
    max: 20,
    default: 9,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Diametro della flangia (foro + 3 … foro + 8)',
  },
  {
    chiave: 'flangia.spessore',
    unita: 'mm',
    min: 0.4,
    max: 1,
    default: 0.6,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore della flangia',
  },
  {
    chiave: 'flangia.raggio',
    unita: 'mm',
    min: 0.2,
    max: 1,
    default: 0.4,
    fonteDefault: 'mestiere',
    descrizione: 'Raggio del bordo della flangia',
  },
  {
    chiave: 'gambo.altezza',
    unita: 'mm',
    min: 2,
    max: 8,
    default: 4,
    fonteDefault: 'mestiere',
    descrizione: 'Altezza del gambo: pelle + 1 mm di ribattitura',
  },
  {
    chiave: 'parete.spessore',
    unita: 'mm',
    min: 0.3,
    max: 0.8,
    default: 0.5,
    fonteDefault: 'mestiere',
    descrizione: 'Parete della lamiera',
  },
  {
    chiave: 'rondella.abilitata',
    unita: 'bool',
    default: false,
    fonteDefault: 'mestiere',
    descrizione: 'Rondella di ribattitura',
  },
  {
    chiave: 'rondella.diametro',
    unita: 'mm',
    default: 8,
    fonteDefault: 'derivato',
    derivato: (p) => (p as ParametriOcchiello).flangia.diametro - 1,
    descrizione: 'Flangia − 1 mm',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['ottone', 'alluminio'],
    default: 'ottone',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale',
  },
];

const predefiniti = (): ParametriOcchiello => predefinitiDaParametri<ParametriOcchiello>(parametri);

const vincoli = (p: ParametriOcchiello): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
  if (p.flangia.diametro < p.foro.diametro + 3 || p.flangia.diametro > p.foro.diametro + 8) {
    violati.push({ chiave: 'flangia.diametro', messaggio: 'La flangia va da foro + 3 a foro + 8 mm.' });
  }
  if (p.flangia.raggio > 0.45 * p.flangia.spessore * 2) {
    violati.push({ chiave: 'flangia.raggio', messaggio: 'Il raggio supera lo spessore della flangia.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown): ParametriOcchiello => {
  const p = normalizzaConParametri(parametri, grezzi, predefiniti());
  p.flangia.diametro = limita(p.flangia.diametro, p.foro.diametro + 3, p.foro.diametro + 8);
  p.flangia.raggio = Math.min(p.flangia.raggio, 0.9 * p.flangia.spessore);
  return p;
};

/**
 * Volume teorico senza raccordi: gambo (corona fra foro e foro + parete) e flangia (corona fino al diametro).
 * @param p - Parametri.
 * @returns mm³.
 */
export function volumeOcchiello(p: ParametriOcchiello): number {
  const ri = p.foro.diametro / 2;
  const ro = ri + p.parete.spessore;
  const rf = p.flangia.diametro / 2;
  return Math.PI * ((ro ** 2 - ri ** 2) * p.gambo.altezza + (rf ** 2 - ri ** 2) * p.flangia.spessore);
}

function costruisciConEsiti(lib: Lib, p: ParametriOcchiello): RisultatoCostruzione {
  const esiti: Esito[] = [];
  const pezzi: PezzoFamiglia[] = [];
  const ri = p.foro.diametro / 2;
  const ro = ri + p.parete.spessore;
  const rf = p.flangia.diametro / 2;
  const h = p.gambo.altezza;
  const s = p.flangia.spessore;
  try {
    const profilo = lib.Polygon([ri, -h], [ro, -h], [ro, 0], [rf, 0], [rf, s], [ri, s]).on(lib.Plane.XZ);
    let corpo = profilo.revolve(lib.Z);
    const bordo = corpo.edges().filter((spigolo) => spigolo.geomType === 'circle' && spigolo.radius > ro + 1e-6);
    try {
      corpo = corpo.fillet(bordo, Math.min(p.flangia.raggio, 0.45 * s));
    } catch {
      esiti.push(esito('avviso', 'RACCORDO_RIDOTTO', 'Bordo della flangia senza raccordo.', { pezzo: 'Occhiello' }));
    }
    const { materiale } = p.costruzione;
    pezzi.push({
      name: 'Occhiello',
      shape: normalizzaForma(lib, corpo),
      ruolo: 'occhiello',
      materiale,
      ...aspettoMateriale(materiale),
    });
    if (p.rondella.abilitata) {
      const rondella = lib
        .Pos(0, 0, -h)
        .mul(lib.Circle((p.flangia.diametro - 1) / 2).cut(lib.Circle(ro + 0.2)))
        .extrude(s);
      pezzi.push({
        name: 'Rondella',
        shape: normalizzaForma(lib, rondella),
        ruolo: 'rondella',
        materiale,
        ...aspettoMateriale(materiale),
      });
    }
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Occhiello non costruito: ${(error as Error).message}`, {
        pezzo: 'Occhiello',
      }),
    );
  }
  return { pezzi, esiti };
}

function verifiche(lib: Lib, pezzi: readonly PezzoFamiglia[], p: ParametriOcchiello): Esito[] {
  const esiti: Esito[] = [];
  const parete = p.parete.spessore;
  esiti.push(
    parete >= 0.3 && parete <= 0.8
      ? esito('ok', 'PARETE_MIN', `Parete di ${mm(parete)} per l’imbutitura (0,3–0,8).`, {
          pezzo: 'Occhiello',
          valore: parete,
        })
      : esito('avviso', 'PARETE_MIN', `Parete di ${mm(parete)} fuori da 0,3–0,8 mm.`, {
          pezzo: 'Occhiello',
          valore: parete,
        }),
  );
  const rapporto = p.flangia.diametro / p.foro.diametro;
  esiti.push(
    rapporto >= 1.4 && rapporto <= 2.5
      ? esito('ok', 'FLANGIA_FORO', `Flangia / foro = ${rapporto.toFixed(2)}.`, { valore: rapporto })
      : esito('avviso', 'FLANGIA_FORO', `Flangia / foro = ${rapporto.toFixed(2)}: fuori da 1,4–2,5.`, {
          valore: rapporto,
        }),
  );
  const massima = 6 * parete + 2;
  esiti.push(
    p.gambo.altezza <= massima
      ? esito('ok', 'IMBUTITURA', `Gambo di ${mm(p.gambo.altezza)}: imbutitura normale.`, {
          valore: p.gambo.altezza,
          soglia: massima,
        })
      : esito('avviso', 'IMBUTITURA', `Gambo di ${mm(p.gambo.altezza)}: imbutitura profonda (oltre ${mm(massima)}).`, {
          valore: p.gambo.altezza,
          soglia: massima,
        }),
  );
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

export const occhiello: Famiglia<ParametriOcchiello> = {
  id: 'occhiello',
  versione: 1,
  varianti: ['standard'],
  partTypes: ['eyelet'],
  schema: schemaDaParametri<ParametriOcchiello>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['z'], simmetrie: ['yz', 'xz'] },
  materialiAmmessi: ['ottone', 'alluminio'],
  emettiMain: (p, ipotesi) => emettiMainFamiglia('occhiello', 1, 'standard', p, ipotesi),
};
