/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';
import type { DefinizioneParametro, Esito, Famiglia, PezzoFamiglia, RisultatoCostruzione } from '#famiglie/famiglia.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import { aspettoMateriale } from '#famiglie/materiali.js';
import { limita, normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { esitiPezzi, esito, esitoMinimo, mm, normalizzaForma } from '#famiglie/verifiche-comuni.js';

/**
 * Famiglia `puntale` (specifica §1.6): puntalino di lamiera imbutita a quarto d'ellissoide. Telaio: apertura sul retro
 * (y = 0) e sotto (z = 0), punta verso +Y, larghezza lungo X. Ellissoide = sfera scalata per asse (`scale` con
 * vettore, T-D1-02), tagliata dai due piani e svuotata con due aperture piane; due fori di fissaggio.
 */

type Lib = typeof Smlib;

/**
 * Parametri della famiglia puntale, annidati per pezzo.
 * @public
 */
export type ParametriPuntale = {
  puntale: { lunghezza: number; larghezza: number; altezza: number; spessore: number };
  fori: { numero: number; diametro: number };
  costruzione: { materiale: 'ottone' | 'inox' | 'alluminio' };
};

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'puntale.lunghezza',
    unita: 'mm',
    min: 10,
    max: 60,
    default: 25,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Lunghezza (dal retro alla punta)',
  },
  {
    chiave: 'puntale.larghezza',
    unita: 'mm',
    min: 10,
    max: 60,
    default: 30,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza',
  },
  {
    chiave: 'puntale.altezza',
    unita: 'mm',
    min: 4,
    max: 25,
    default: 10,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Altezza',
  },
  {
    chiave: 'puntale.spessore',
    unita: 'mm',
    min: 0.4,
    max: 1.2,
    default: 0.6,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore della lamiera',
  },
  {
    chiave: 'fori.numero',
    unita: 'n',
    min: 0,
    max: 2,
    passo: 2,
    default: 2,
    fonteDefault: 'mestiere',
    descrizione: 'Fori di fissaggio (0 o 2)',
  },
  {
    chiave: 'fori.diametro',
    unita: 'mm',
    min: 1,
    max: 3,
    default: 1.6,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro dei fori',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['ottone', 'inox', 'alluminio'],
    default: 'ottone',
    fonteDefault: 'mestiere',
    descrizione: 'Lamiera',
  },
];

const predefiniti = (): ParametriPuntale => predefinitiDaParametri<ParametriPuntale>(parametri);

/** Il raggio di curvatura più piccolo dell'ellissoide di semiassi dati (min a² / max). */
const raggioMinimo = (p: ParametriPuntale): number => {
  const semiassi = [p.puntale.larghezza / 2, p.puntale.lunghezza, p.puntale.altezza];
  return Math.min(...semiassi) ** 2 / Math.max(...semiassi);
};

const vincoli = (p: ParametriPuntale): Array<{ chiave: string; messaggio: string }> =>
  p.puntale.spessore * 3 > p.puntale.altezza
    ? [{ chiave: 'puntale.spessore', messaggio: 'La lamiera supera un terzo dell’altezza.' }]
    : [];

const normalizza = (grezzi: unknown): ParametriPuntale => {
  const p = normalizzaConParametri(parametri, grezzi, predefiniti());
  p.puntale.spessore = limita(p.puntale.spessore, 0.4, p.puntale.altezza / 3);
  return p;
};

function costruisciConEsiti(lib: Lib, p: ParametriPuntale): RisultatoCostruzione {
  const esiti: Esito[] = [];
  const { lunghezza, larghezza, altezza, spessore } = p.puntale;
  try {
    const retro = new lib.Plane([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const ellissoide = (a: number, b: number, c: number): Smlib.Part =>
      lib.Sphere(1, { align: null }).scale([a, b, c]).split(lib.Plane.XY, 'above').split(retro, 'above');
    const pieno = ellissoide(larghezza / 2, lunghezza, altezza);
    let guscio: Smlib.Part;
    try {
      const aperture = pieno.faces().filter((faccia) => faccia.isPlanar);
      guscio = pieno.shell(spessore, aperture);
    } catch {
      // Ripiego: differenza di due ellissoidi (parete esatta sui semiassi, quasi uniforme altrove).
      guscio = pieno.cut(
        ellissoide(larghezza / 2 - spessore, lunghezza - spessore, altezza - spessore).translate(0, -1e-3, -1e-3),
      );
      esiti.push(
        esito('info', 'GUSCIO', {
          messaggio: 'Guscio per differenza di ellissoidi (il kernel non ha svuotato la sfera scalata).',
          pezzo: 'Puntale',
        }),
      );
    }
    if (p.fori.numero > 0) {
      const fori = [-1, 1].map((lato) =>
        lib.Pos((lato * larghezza) / 4, lunghezza * 0.3, -1).mul(
          lib.Cylinder(p.fori.diametro / 2, altezza + 2, {
            align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN],
          }),
        ),
      );
      guscio = guscio.cut(...fori);
    }
    const forma = normalizzaForma(lib, guscio);
    if (!forma.isValid()) {
      esiti.push(
        esito('blocco', 'SOLIDO_NON_VALIDO', { messaggio: 'Il puntale non è un solido valido.', pezzo: 'Puntale' }),
      );
    }
    const { materiale } = p.costruzione;
    return {
      pezzi: [{ name: 'Puntale', shape: forma, ruolo: 'puntale', materiale, ...aspettoMateriale(materiale) }],
      esiti,
    };
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', {
        messaggio: `Puntale non costruito: ${(error as Error).message}`,
        pezzo: 'Puntale',
      }),
    );
    return { pezzi: [], esiti };
  }
}

// oxlint-disable-next-line eslint/max-params -- firma del contratto delle famiglie (§1.0): lib, pezzi, parametri, processo, opzioni.
function verifiche(lib: Lib, pezzi: readonly PezzoFamiglia[], p: ParametriPuntale): Esito[] {
  const esiti: Esito[] = [];
  const { altezza, spessore } = p.puntale;
  esiti.push(
    spessore >= 0.4 && spessore <= 1.2
      ? esito('ok', 'PARETE_MIN', {
          messaggio: `Lamiera di ${mm(spessore)} (0,4–1,2).`,
          pezzo: 'Puntale',
          valore: spessore,
        })
      : esito('avviso', 'PARETE_MIN', {
          messaggio: `Lamiera di ${mm(spessore)} fuori da 0,4–1,2 mm.`,
          pezzo: 'Puntale',
          valore: spessore,
        }),
  );
  const rapporto = altezza / spessore;
  esiti.push(
    rapporto <= 25
      ? esito('ok', 'IMBUTITURA', {
          messaggio: `Altezza / spessore = ${rapporto.toFixed(1)}.`,
          valore: rapporto,
          soglia: 25,
        })
      : esito('avviso', 'IMBUTITURA', {
          messaggio: `Altezza / spessore = ${rapporto.toFixed(1)}: imbutitura profonda (oltre 25).`,
          valore: rapporto,
          soglia: 25,
        }),
  );
  esiti.push(
    esitoMinimo('RAGGI_MIN', {
      valore: raggioMinimo(p),
      soglia: 2 * spessore,
      cosa: 'Raggio di curvatura minimo',
      pezzo: 'Puntale',
      fattoreBlocco: 0,
    }),
  );
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

/**
 * La famiglia puntale.
 * @public
 */
export const puntale: Famiglia<ParametriPuntale> = {
  id: 'puntale',
  versione: 1,
  varianti: ['quarto_ellissoide'],
  partTypes: [],
  schema: schemaDaParametri<ParametriPuntale>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['x', 'y', 'z'], simmetrie: ['yz'] },
  materialiAmmessi: ['ottone', 'inox', 'alluminio'],
  emettiMain: (p, ipotesi) =>
    emettiMainFamiglia({ id: 'puntale', versione: 1, variante: 'quarto_ellissoide' }, p, ipotesi),
};
