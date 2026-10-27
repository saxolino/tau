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
import {
  lunghezzaDaTaglia,
  piantaDaMisure,
  STAZIONE_PIANTA,
  STAZIONE_TALLONE,
} from '#famiglie/fondo-pianta-canonica.js';
import type { Pianta } from '#famiglie/fondo-pianta-canonica.js';
import { aspettoMateriale } from '#famiglie/materiali.js';
import { normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaSformo } from '#famiglie/processi.js';
import { esitiPezzi, esitiSformo, esito, esitoMinimo, normalizzaForma, sformo } from '#famiglie/verifiche-comuni.js';

/**
 * Famiglia `fondo_semplice` (specifica §1.2): zeppa, platform o fondo in cuoio liscio.
 *
 * Telaio locale: piano d'appoggio z = 0 = minimo assoluto della suola; +Y verso la punta, origine sotto il centro del
 * tallone. La pianta viene dalla taglia (`fondo-pianta-canonica.ts`), allargata del sormonto; il blocco è estruso con
 * lo sformo dei fianchi e tagliato sopra e sotto da due superfici `surface(griglia)`: sotto il rialzo di punta (zero
 * fino alla zona metatarsale), sopra il fondo più lo spessore, che passa da quello del tallone (fino al centro del
 * tallone) a quello della punta (dalla linea delle teste in avanti). Lo spessore segue il rialzo, così in punta resta
 * `spessore.punta` (la formula del §1.2 passo 3, senza rialzo, lo assottiglierebbe del rialzo).
 */

type Lib = typeof Smlib;

export type VarianteFondo = 'zeppa' | 'platform' | 'cuoio_liscio';
type MaterialeFondo = 'tr' | 'tpu' | 'gomma' | 'eva' | 'pu_espanso' | 'cuoio' | 'sughero';

export type ParametriFondo = {
  pianta: { taglia: number; rapportoPianta: number; rapportoTallone: number; sormonto: number };
  spessore: { punta: number; tallone: number; puntaRialzo: number };
  fianco: { sformo: number };
  bordo: { raggioSuperiore: number; raggioInferiore: number };
  costruzione: { materiale: MaterialeFondo; lato: 'dx' | 'sx' | 'coppia' };
};

const varianti = ['platform', 'zeppa', 'cuoio_liscio'] as const;

const lunghezzaDi = (p: ParametriFondo): number => lunghezzaDaTaglia(p.pianta.taglia);
const piantaDi = (p: ParametriFondo): Pianta => {
  const lunghezza = lunghezzaDi(p);
  return piantaDaMisure({
    lunghezza,
    larghezzaPianta: p.pianta.rapportoPianta * lunghezza,
    larghezzaTallone: p.pianta.rapportoTallone * lunghezza,
  });
};

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'pianta.taglia',
    unita: 'n',
    min: 35,
    max: 47,
    passo: 0.5,
    default: 37,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Taglia EU',
  },
  {
    chiave: 'pianta.lunghezza',
    unita: 'mm',
    default: 258.7,
    fonteDefault: 'derivato',
    derivato: (p) => lunghezzaDi(p as ParametriFondo),
    descrizione: 'Taglia × 6,667 + 12 (ipotesi dichiarata)',
  },
  {
    chiave: 'pianta.rapportoPianta',
    unita: 'frazione',
    min: 0.3,
    max: 0.45,
    default: 0.37,
    fonteDefault: 'derivato',
    silhouetteSensibile: true,
    descrizione: 'Larghezza in pianta / lunghezza',
  },
  {
    chiave: 'pianta.rapportoTallone',
    unita: 'frazione',
    min: 0.2,
    max: 0.32,
    default: 0.25,
    fonteDefault: 'derivato',
    descrizione: 'Larghezza al tallone / lunghezza',
  },
  {
    chiave: 'pianta.larghezzaPianta',
    unita: 'mm',
    default: 95.7,
    fonteDefault: 'derivato',
    derivato: (p) => (p as ParametriFondo).pianta.rapportoPianta * lunghezzaDi(p as ParametriFondo),
    descrizione: 'Larghezza in pianta',
  },
  {
    chiave: 'pianta.larghezzaTallone',
    unita: 'mm',
    default: 64.7,
    fonteDefault: 'derivato',
    derivato: (p) => (p as ParametriFondo).pianta.rapportoTallone * lunghezzaDi(p as ParametriFondo),
    descrizione: 'Larghezza al tallone',
  },
  {
    chiave: 'pianta.sormonto',
    unita: 'mm',
    min: 0,
    max: 12,
    default: 2.5,
    fonteDefault: 'mestiere',
    descrizione: 'Sormonto oltre la forma (2,5 montato · 8 guardolo)',
  },
  {
    chiave: 'spessore.punta',
    unita: 'mm',
    min: 3,
    max: 60,
    default: 12,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Spessore in punta',
  },
  {
    chiave: 'spessore.tallone',
    unita: 'mm',
    min: 3,
    max: 120,
    default: 12,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Spessore al tallone',
  },
  {
    chiave: 'spessore.puntaRialzo',
    unita: 'mm',
    min: 0,
    max: 25,
    default: 10,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Rialzo di punta (toe spring)',
  },
  {
    chiave: 'fianco.sformo',
    unita: 'deg',
    min: 0,
    max: 6,
    default: 1.5,
    fonteDefault: 'mestiere',
    descrizione: 'Sformo dei fianchi (TR/TPU 1,5 · gomma 4 · cuoio 0)',
  },
  {
    chiave: 'bordo.raggioSuperiore',
    unita: 'mm',
    min: 0,
    max: 6,
    default: 2,
    fonteDefault: 'mestiere',
    descrizione: 'Raccordo del bordo superiore',
  },
  {
    chiave: 'bordo.raggioInferiore',
    unita: 'mm',
    min: 0,
    max: 3,
    default: 1,
    fonteDefault: 'mestiere',
    descrizione: 'Raccordo del bordo inferiore',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['tr', 'tpu', 'gomma', 'eva', 'pu_espanso', 'cuoio', 'sughero'],
    default: 'tr',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale',
  },
  {
    chiave: 'costruzione.lato',
    unita: 'enum',
    valori: ['dx', 'sx', 'coppia'],
    default: 'coppia',
    fonteDefault: 'mestiere',
    descrizione: 'Destro, sinistro o la coppia',
  },
];

const sostituzioniVariante: Readonly<Record<VarianteFondo, Readonly<Record<string, number | string>>>> = {
  platform: {},
  zeppa: { 'spessore.punta': 8, 'spessore.tallone': 60, 'spessore.puntaRialzo': 12 },
  cuoio_liscio: {
    'spessore.punta': 4.5,
    'spessore.tallone': 4.5,
    'spessore.puntaRialzo': 8,
    'fianco.sformo': 0,
    'bordo.raggioSuperiore': 0,
    'bordo.raggioInferiore': 0,
    'costruzione.materiale': 'cuoio',
  },
};

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteFondo =>
  varianti.includes(opzioni?.variante as VarianteFondo) ? (opzioni!.variante as VarianteFondo) : 'platform';

const predefiniti = (variante?: string): ParametriFondo =>
  predefinitiDaParametri<ParametriFondo>(parametri, sostituzioniVariante[varianteDi({ variante })]);

const vincoli = (p: ParametriFondo): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
  const { spessore, fianco, costruzione } = p;
  if (costruzione.materiale !== 'cuoio' && spessore.tallone < spessore.punta) {
    violati.push({ chiave: 'spessore.tallone', messaggio: 'Il tallone è più sottile della punta.' });
  }
  if (
    costruzione.materiale === 'cuoio' &&
    (spessore.punta !== spessore.tallone || spessore.punta < 3.5 || spessore.punta > 6 || fianco.sformo !== 0)
  ) {
    violati.push({ chiave: 'spessore.punta', messaggio: 'Cuoio: spessore unico 3,5–6 mm e fianchi dritti.' });
  }
  if (spessore.puntaRialzo > spessore.punta + 20) {
    violati.push({ chiave: 'spessore.puntaRialzo', messaggio: 'Il rialzo supera lo spessore in punta + 20 mm.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriFondo => {
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(varianteDi(opzioni)));
  const { spessore, fianco, costruzione } = p;
  if (costruzione.materiale === 'cuoio') {
    const unico = Math.min(6, Math.max(3.5, spessore.punta));
    spessore.punta = unico;
    spessore.tallone = unico;
    fianco.sformo = 0;
  } else {
    spessore.tallone = Math.max(spessore.tallone, spessore.punta);
  }
  spessore.puntaRialzo = Math.min(spessore.puntaRialzo, spessore.punta + 20);
  return p;
};

const raccordo = (u: number): number => {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
};

/** Le quote del fondo e della superficie superiore alla y della pianta. */
function quote(p: ParametriFondo, pianta: Pianta): { sotto: (y: number) => number; sopra: (y: number) => number } {
  const { punta, tallone, puntaRialzo } = p.spessore;
  const flesso = pianta.yPunta - 0.3 * pianta.lunghezza;
  const sotto = (y: number): number => puntaRialzo * Math.max(0, (y - flesso) / (pianta.yPunta - flesso)) ** 2;
  const yPianta = (STAZIONE_PIANTA - STAZIONE_TALLONE) * pianta.lunghezza;
  const spessoreA = (y: number): number => tallone + (punta - tallone) * raccordo(y / yPianta);
  return { sotto, sopra: (y) => sotto(y) + spessoreA(y) };
}

/**
 * Una superficie che dipende solo da y, oltre i margini della pianta (così taglia tutto il blocco). Le righe della
 * griglia sono i punti di controllo (`interpolate: false`): dove i punti stanno a z = 0 la superficie è esattamente
 * piana e non scende mai sotto (inviluppo convesso), e due superfici con punti a distanza costante restano a quella
 * distanza. Righe fitte sulle stazioni dello spessore e del rialzo.
 */
function superficie(lib: Lib, pianta: Pianta, quota: (y: number) => number, larghezza: number): Smlib.Shell {
  const yPianta = (STAZIONE_PIANTA - STAZIONE_TALLONE) * pianta.lunghezza;
  const flesso = pianta.yPunta - 0.3 * pianta.lunghezza;
  const righe = [
    pianta.yTallone - 30,
    pianta.yTallone - 15,
    pianta.yTallone,
    pianta.yTallone / 2,
    0,
    ...Array.from({ length: 6 }, (_, k) => (yPianta * (k + 1)) / 7),
    yPianta,
    ...Array.from({ length: 3 }, (_, k) => yPianta + ((flesso - yPianta) * (k + 1)) / 4),
    flesso,
    ...Array.from({ length: 5 }, (_, k) => flesso + ((pianta.yPunta - flesso) * (k + 1)) / 6),
    pianta.yPunta,
    pianta.yPunta + 15,
    pianta.yPunta + 30,
  ];
  const griglia = righe.map((y) =>
    Array.from(
      { length: 5 },
      (_, j) =>
        [
          -larghezza + (2 * larghezza * j) / 4,
          y,
          quota(Math.min(pianta.yPunta, Math.max(pianta.yTallone, y))),
        ] as const,
    ),
  );
  return lib.surface(griglia, { interpolate: false });
}

function costruisciDestro(lib: Lib, p: ParametriFondo, esiti: Esito[]): Smlib.Part {
  const pianta = piantaDi(p);
  let contorno = lib.makeFace(lib.Spline(...pianta.contorno, { closed: true }));
  if (p.pianta.sormonto > 0) {
    contorno = contorno.offset(p.pianta.sormonto, { corners: 'round' });
  }
  const { sotto, sopra } = quote(p, pianta);
  // Il blocco parte 1 mm sotto il suolo: la superficie di fondo (a z = 0 fuori dal rialzo) lo taglia ovunque.
  const altezza = p.spessore.tallone + p.spessore.puntaRialzo + 3;
  const base = lib.Pos(0, 0, -1).mul(contorno);
  let blocco = p.fianco.sformo > 0 ? base.extrude(altezza, { taper: p.fianco.sformo }) : base.extrude(altezza);
  const larghezza = pianta.larghezzaPianta + 2 * p.pianta.sormonto + 20;
  // Il verso della normale di `surface` dipende dalla griglia: si sceglie il lato guardando la normale.
  const taglia = (parte: Smlib.Part, quota: (y: number) => number, tieni: 'sotto' | 'sopra'): Smlib.Part => {
    const faccia = superficie(lib, pianta, quota, larghezza).faces()[0]!;
    const insu = faccia.normalAt(faccia.interiorPoint()).z > 0;
    return parte.split(faccia, (tieni === 'sopra') === insu ? 'above' : 'below');
  };
  blocco = taglia(taglia(blocco, sopra, 'sotto'), sotto, 'sopra');
  blocco = normalizzaForma(lib, blocco);
  const { raggioSuperiore, raggioInferiore } = p.bordo;
  const centro = (spigolo: Smlib.Edge): number => spigolo.center().z;
  if (p.costruzione.materiale === 'cuoio') {
    try {
      blocco = blocco.chamfer(
        blocco.edges().filter((spigolo) => centro(spigolo) > p.spessore.punta * 0.5),
        0.5,
      );
    } catch {
      esiti.push(esito('avviso', 'RACCORDO_RIDOTTO', 'Bordo fresato del cuoio non costruito.', { pezzo: 'Fondo' }));
    }
  } else {
    // Un solo raccordo per i due bordi (un raggio per spigolo): metà tempo di due chiamate.
    const massimo = 0.45 * p.spessore.punta;
    const spigoli = [...blocco.edges()].flatMap((spigolo) => {
      const sopraIlFondo = centro(spigolo) > sotto(spigolo.center().y) + 1;
      const raggio = Math.min(sopraIlFondo ? raggioSuperiore : raggioInferiore, massimo);
      return raggio > 0 ? [{ spigolo, raggio }] : [];
    });
    if (spigoli.length > 0) {
      try {
        blocco = blocco.fillet(
          spigoli.map(({ spigolo }) => spigolo),
          spigoli.map(({ raggio }) => raggio),
        );
      } catch {
        esiti.push(
          esito('avviso', 'RACCORDO_RIDOTTO', 'Raccordi dei bordi non costruibili: spigoli vivi.', { pezzo: 'Fondo' }),
        );
      }
    }
  }
  return normalizzaForma(lib, blocco);
}

function costruisciConEsiti(lib: Lib, p: ParametriFondo): RisultatoCostruzione {
  const esiti: Esito[] = [];
  const { materiale, lato } = p.costruzione;
  try {
    const destro = costruisciDestro(lib, p, esiti);
    if (!destro.isValid()) {
      esiti.push(esito('blocco', 'SOLIDO_NON_VALIDO', 'Il fondo non è un solido valido.', { pezzo: 'Fondo DX' }));
    }
    const pezzo = (nome: string, forma: Smlib.Part): PezzoFamiglia => ({
      name: nome,
      shape: forma,
      ruolo: 'fondo',
      materiale,
      ...aspettoMateriale(materiale),
    });
    if (lato === 'dx') {
      return { pezzi: [pezzo('Fondo DX', destro)], esiti };
    }
    if (lato === 'sx') {
      return { pezzi: [pezzo('Fondo SX', normalizzaForma(lib, destro.mirror(lib.Plane.YZ)))], esiti };
    }
    const scostamento = piantaDi(p).larghezzaPianta / 2 + p.pianta.sormonto + 15;
    const spostato = destro.translate(scostamento, 0, 0);
    return {
      pezzi: [pezzo('Fondo DX', spostato), pezzo('Fondo SX', normalizzaForma(lib, spostato.mirror(lib.Plane.YZ)))],
      esiti,
    };
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Fondo non costruito: ${(error as Error).message}`, { pezzo: 'Fondo' }),
    );
    return { pezzi: [], esiti };
  }
}

const sogliaSpessore: Readonly<Record<MaterialeFondo, number>> = {
  tr: 1.5,
  tpu: 1.5,
  gomma: 2.5,
  eva: 3,
  pu_espanso: 3,
  cuoio: 3.5,
  sughero: 3,
};
const ritiri: Readonly<Partial<Record<MaterialeFondo, string>>> = {
  eva: '1,5–2,5 %',
  tr: '0,8–1,2 %',
  tpu: '0,8–1,2 %',
  gomma: '1,5–2 %',
  pu_espanso: '1–2 %',
};

function verifiche(lib: Lib, pezzi: readonly PezzoFamiglia[], p: ParametriFondo): Esito[] {
  const esiti: Esito[] = [];
  const { materiale } = p.costruzione;
  const minimo = Math.min(p.spessore.punta, p.spessore.tallone);
  esiti.push(
    esitoMinimo('SPESSORE_MIN', minimo, sogliaSpessore[materiale], 'Spessore minimo (fondo pieno)', { pezzo: 'Fondo' }),
  );
  const processo: Processo = materiale === 'cuoio' ? 'taglio_cuoio' : 'stampaggio_iniezione';
  const minimoSformo = materiale === 'cuoio' ? undefined : (sogliaSformo(processo, materiale) ?? 1);
  const fondo = pezzi[0]?.shape;
  if (minimoSformo !== undefined && fondo instanceof lib.Part) {
    // I fianchi (quasi verticali, raccordi esclusi): i raccordi dei bordi stanno nei semistampi di sopra e di sotto.
    const raccordi = fondo.faces().fillets(Math.max(p.bordo.raggioSuperiore, p.bordo.raggioInferiore) + 0.5);
    const fianchi = fondo
      .faces()
      .filter(
        (faccia) =>
          Math.abs(faccia.normalAt(faccia.interiorPoint()).z) < 0.2 &&
          !raccordi.some((raccordo) => raccordo.equals(faccia)),
      );
    esiti.push(
      ...esitiSformo(
        sformo(fondo, [0, 0, 1], minimoSformo - 1e-3, fianchi),
        minimoSformo,
        pezzi[0]!.name,
        'Fianchi del fondo',
      ),
    );
  }
  const ritiro = ritiri[materiale];
  if (ritiro) {
    esiti.push(esito('info', 'RITIRO', `Ritiro ${ritiro}: dichiarato nell’export, non applicato.`));
  }
  if (materiale !== 'cuoio') {
    const raggio = Math.min(p.bordo.raggioSuperiore, p.bordo.raggioInferiore);
    esiti.push(esitoMinimo('RAGGI_MIN', raggio, 0.5, 'Raggio minimo dei bordi', { pezzo: 'Fondo', fattoreBlocco: 0 }));
  }
  esiti.push(
    esito(
      'avviso',
      'GRADING',
      'Sviluppo taglie dalla pianta per taglia: non disponibile, il fondificio sviluppa sulla forma campione.',
    ),
  );
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

export const fondoSemplice: Famiglia<ParametriFondo> = {
  id: 'fondo_semplice',
  versione: 1,
  varianti,
  partTypes: ['sole', 'midsole_wedge', 'welt'],
  schema: schemaDaParametri<ParametriFondo>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['x', 'y', 'z'], simmetrie: ['yz'] },
  materialiAmmessi: ['tr', 'tpu', 'gomma', 'eva', 'pu_espanso', 'cuoio', 'sughero'],
  emettiMain: (p, ipotesi, opzioni) => emettiMainFamiglia('fondo_semplice', 1, varianteDi(opzioni), p, ipotesi),
};
