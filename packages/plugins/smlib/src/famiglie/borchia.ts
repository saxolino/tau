/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';
import type {
  DefinizioneParametro,
  Esito,
  Famiglia,
  OpzioniFamiglia,
  PezzoFamiglia,
  Processo,
  RisultatoCostruzione,
} from '#famiglie/famiglia.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import { aspettoMateriale } from '#famiglie/materiali.js';
import { normalizzaConParametri, predefinitiDaParametri, radianti, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaSformo } from '#famiglie/processi.js';
import {
  esitiPezzi,
  esitiSformo,
  esito,
  esitoMinimo,
  normalizzaForma,
  sformoDuePiani,
} from '#famiglie/verifiche-comuni.js';
import { faccia as f } from '#famiglie/viste.js';

/**
 * Famiglia `borchia` (ribattino, specifica §1.4): testa sopra z = 0 (cupola, piramide, piatta, cono), gambo verso
 * −Z. In pressofusione il gambo è un cono sformato e la testa si può svuotare da sotto.
 */

type Lib = typeof Smlib;

/**
 * Varianti della famiglia borchia.
 * @public
 */
export type VarianteBorchia = 'cupola' | 'piramide' | 'piatta' | 'cono';

/**
 * Parametri della famiglia borchia, annidati per pezzo.
 * @public
 */
export type ParametriBorchia = {
  testa: { forma: VarianteBorchia; diametro: number; altezza: number; lati: number };
  gambo: { diametro: number; lunghezza: number };
  costruzione: {
    processo: 'pressofusione_zama' | 'cnc';
    materiale: 'zama' | 'ottone';
    cava: boolean;
    parete: number;
    sformo: number;
  };
};

const varianti = ['cupola', 'piramide', 'piatta', 'cono'] as const;

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'testa.forma',
    unita: 'enum',
    valori: [...varianti],
    default: 'cupola',
    fonteDefault: 'mestiere',
    descrizione: 'Forma della testa',
  },
  {
    chiave: 'testa.diametro',
    unita: 'mm',
    min: 4,
    max: 25,
    default: 8,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Diametro della testa',
  },
  {
    chiave: 'testa.altezza',
    unita: 'mm',
    min: 1,
    max: 12,
    default: 3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Altezza della testa',
  },
  {
    chiave: 'testa.lati',
    unita: 'n',
    min: 3,
    max: 8,
    default: 4,
    fonteDefault: 'mestiere',
    descrizione: 'Lati della piramide',
  },
  {
    chiave: 'gambo.diametro',
    unita: 'mm',
    min: 1.5,
    max: 4,
    default: 2.5,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro del gambo',
  },
  {
    chiave: 'gambo.lunghezza',
    unita: 'mm',
    min: 3,
    max: 12,
    default: 6,
    fonteDefault: 'mestiere',
    descrizione: 'Lunghezza del gambo',
  },
  {
    chiave: 'costruzione.processo',
    unita: 'enum',
    valori: ['pressofusione_zama', 'cnc'],
    default: 'pressofusione_zama',
    fonteDefault: 'mestiere',
    descrizione: 'Processo',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['zama', 'ottone'],
    default: 'zama',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale',
  },
  {
    chiave: 'costruzione.cava',
    unita: 'bool',
    default: false,
    fonteDefault: 'mestiere',
    descrizione: 'Testa svuotata da sotto',
  },
  {
    chiave: 'costruzione.parete',
    unita: 'mm',
    min: 0.8,
    max: 2,
    default: 1,
    fonteDefault: 'mestiere',
    descrizione: 'Parete della testa cava',
  },
  {
    chiave: 'costruzione.sformo',
    unita: 'deg',
    min: 0.5,
    max: 2,
    default: 1,
    fonteDefault: 'mestiere',
    descrizione: 'Sformo del gambo',
  },
];

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteBorchia =>
  varianti.includes(opzioni?.variante as VarianteBorchia) ? (opzioni!.variante as VarianteBorchia) : 'cupola';

const predefiniti = (variante?: string): ParametriBorchia => {
  const forma = varianteDi({ variante });
  return predefinitiDaParametri<ParametriBorchia>(parametri, {
    'testa.forma': forma,
    ...(forma === 'piramide' ? { 'testa.altezza': 4 } : {}),
  });
};

const vincoli = (p: ParametriBorchia): Array<{ chiave: string; messaggio: string }> => {
  const violati: Array<{ chiave: string; messaggio: string }> = [];
  if (p.testa.forma === 'cupola' && p.testa.altezza > p.testa.diametro / 2) {
    violati.push({ chiave: 'testa.altezza', messaggio: 'Una cupola più alta di mezzo diametro va in sottosquadro.' });
  }
  if (p.gambo.diametro > p.testa.diametro * 0.6) {
    violati.push({ chiave: 'gambo.diametro', messaggio: 'Il gambo supera il 60 % della testa.' });
  }
  if ((p.costruzione.processo === 'pressofusione_zama') !== (p.costruzione.materiale === 'zama')) {
    violati.push({ chiave: 'costruzione.materiale', messaggio: 'Zama in pressofusione, ottone a macchina.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriBorchia => {
  const variante = opzioni?.variante === undefined ? undefined : varianteDi(opzioni);
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(variante));
  if (variante) {
    p.testa.forma = variante;
  }
  if (p.testa.forma === 'cupola') {
    p.testa.altezza = Math.min(p.testa.altezza, p.testa.diametro / 2);
  }
  p.gambo.diametro = Math.min(p.gambo.diametro, p.testa.diametro * 0.6);
  p.costruzione.materiale = p.costruzione.processo === 'pressofusione_zama' ? 'zama' : 'ottone';
  if (p.costruzione.processo !== 'pressofusione_zama') {
    p.costruzione.cava = false;
  }
  return p;
};

/**
 * Raggio della sfera di una calotta di corda d e freccia h.
 * @public
 */
export const raggioCalotta = (d: number, h: number): number => (d ** 2 / 4 + h ** 2) / (2 * h);

function testa(lib: Lib, p: ParametriBorchia): Smlib.Part {
  const { forma, diametro: d, altezza: h, lati } = p.testa;
  if (forma === 'cupola') {
    const r = raggioCalotta(d, h);
    return lib
      .Sphere(r, { align: null })
      .split(lib.Plane.XY.offset(r - h), 'above')
      .translate(0, 0, h - r);
  }
  if (forma === 'piramide') {
    return lib.loft(
      [lib.RegularPolygon(d / 2, lati), lib.Pos(0, 0, h).mul(lib.RegularPolygon(Math.min(0.3, d / 10), lati))],
      { ruled: true },
    );
  }
  if (forma === 'cono') {
    return lib.Cone(d / 2, Math.min(0.5, d / 8), h, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] });
  }
  const piatta = lib.Cylinder(d / 2, h, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] });
  return piatta.fillet(piatta.edges().top(), Math.min(0.3 * h, 0.2 * d));
}

function costruisciConEsiti(lib: Lib, p: ParametriBorchia): RisultatoCostruzione {
  const esiti: Esito[] = [];
  try {
    const zama = p.costruzione.processo === 'pressofusione_zama';
    let corpo = testa(lib, p);
    let cima = 0.5;
    if (p.costruzione.cava) {
      const fondo = corpo.faces().filter((faccia) => faccia.normalAt(faccia.interiorPoint()).z < -0.99);
      try {
        corpo = corpo.shell(p.costruzione.parete, fondo);
        // Il gambo sale fino al cielo della cavità.
        cima = Math.max(0.5, p.testa.altezza - p.costruzione.parete + 0.5);
      } catch {
        esiti.push(
          esito('avviso', 'CAVA', { messaggio: 'Testa non svuotabile con questa parete: piena.', pezzo: 'Borchia' }),
        );
      }
    }
    const r = p.gambo.diametro / 2;
    const altezza = p.gambo.lunghezza + cima;
    const allineato = { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX] as const };
    const gambo = zama
      ? lib.Cone(Math.max(0.3, r - altezza * Math.tan(radianti(p.costruzione.sformo))), r, altezza, allineato)
      : lib.Cylinder(r, altezza, allineato);
    corpo = corpo.fuse(lib.Pos(0, 0, cima).mul(gambo));
    const { materiale } = p.costruzione;
    return {
      pezzi: [
        {
          name: 'Borchia',
          shape: normalizzaForma(lib, corpo),
          ruolo: 'borchia',
          materiale,
          ...aspettoMateriale(materiale),
        },
      ],
      esiti,
    };
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', {
        messaggio: `Borchia non costruita: ${(error as Error).message}`,
        pezzo: 'Borchia',
      }),
    );
    return { pezzi: [], esiti };
  }
}

// oxlint-disable-next-line eslint/max-params -- firma del contratto delle famiglie (§1.0): lib, pezzi, parametri, processo, opzioni.
function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriBorchia,
  processo: Processo = p.costruzione.processo,
): Esito[] {
  const esiti: Esito[] = [];
  esiti.push(
    esitoMinimo('GAMBO_MIN', { valore: p.gambo.diametro, soglia: 1.8, cosa: 'Diametro del gambo', pezzo: 'Borchia' }),
  );
  if (p.costruzione.cava) {
    esiti.push(
      esitoMinimo('PARETE_MIN', {
        valore: p.costruzione.parete,
        soglia: 1,
        cosa: 'Parete della testa cava',
        pezzo: 'Borchia',
      }),
    );
  }
  const minimo = sogliaSformo(processo);
  const borchia = pezzi[0]?.shape;
  if (minimo !== undefined && borchia instanceof lib.Part) {
    esiti.push(
      ...esitiSformo(sformoDuePiani(borchia, { piano: 0, minimo: minimo - 1e-3 }), {
        soglia: minimo,
        pezzo: 'Borchia',
        dove: 'Borchia (divisione sotto la testa)',
      }),
    );
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

/**
 * La famiglia borchia.
 * @public
 */
export const borchia: Famiglia<ParametriBorchia> = {
  id: 'borchia',
  versione: 1,
  varianti,
  partTypes: ['stud'],
  schema: schemaDaParametri<ParametriBorchia>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  viste: {
    principale: 'sopra',
    facce: [
      f('sopra', 0, 90, 'the head of the stud seen from above, straight on (outline and head diameter, pyramid sides)'),
      f(
        'fianco_esterno',
        90,
        0,
        'side profile of the stud: head on top, shank down (shows head height, dome and shank length)',
      ),
      f('sotto', 180, -90, 'the back of the stud seen from below (shank, hollow head)'),
    ],
    nomi: {
      fronte: { faccia: 'sopra', azimuth: 0, elevation: 0 },
      tre_quarti: { faccia: 'sopra', azimuth: 25, elevation: 40 },
      lato: { faccia: 'fianco_esterno', azimuth: 0, elevation: 0 },
      alto: { faccia: 'sopra', azimuth: 0, elevation: 0 },
    },
  },
  silhouette: { assi: ['z'], simmetrie: ['yz', 'xz'] },
  materialiAmmessi: ['zama', 'ottone'],
  emettiMain: (p, ipotesi, opzioni) =>
    emettiMainFamiglia(
      { id: 'borchia', versione: 1, variante: varianteDi(opzioni ?? { variante: p.testa.forma }) },
      p,
      ipotesi,
    ),
};
