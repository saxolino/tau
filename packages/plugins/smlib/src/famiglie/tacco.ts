/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (viste per nome come `tre_quarti`): snake_case come in Sinopia. */
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
import {
  limita,
  normalizzaConParametri,
  predefinitiDaParametri,
  radianti,
  schemaDaParametri,
} from '#famiglie/parametri.js';
import { sogliaSformo } from '#famiglie/processi.js';
import {
  assePerno,
  cavitaTacco,
  contornoSezione,
  dentroSezione,
  haFusto,
  inclinazioneMassima,
  profiloTacco,
  puntoDaSeduta,
  quotaMassimaVita,
  quotaSeduta,
  sedutaDaPunto,
  sedutaDi,
  sezioneDiCavita,
  strettezzaVita,
  profonditaForo,
  profonditaIncavo,
} from '#famiglie/tacco-profilo.js';
import type {
  CavitaTacco,
  ParametriTacco,
  ProfiloTacco,
  SedutaTacco,
  SezioneTacco,
  VarianteTacco,
} from '#famiglie/tacco-profilo.js';
import {
  esitiPezzi,
  esitiSformo,
  esito,
  esitoMinimo,
  facceAiPunti,
  marcaFacce,
  mm,
  normalizzaForma,
  pareteMinima,
  puntiDiFacce,
  puntiMarcati,
  sformo,
  trasportaMarcatori,
} from '#famiglie/verifiche-comuni.js';
import { misuraPezzo } from '#famiglie/sonda-tempi.js';
import { faccia as f } from '#famiglie/viste.js';

/**
 * Famiglia `tacco` (specifica §1.1): varianti stiletto, blocco, rocchetto, cono e kitten.
 *
 * Ricetta v2. La forma la dà `tacco-profilo.ts` come la disegna il modellista (dorso e petto di fianco, larghezza da
 * dietro, pianta a scudo, seduta inclinata e concava); qui diventa solido:
 * - corpo = `loft` liscio di sezioni orizzontali, ognuna una spline chiusa per gli stessi 32 punti parametrici (stesso
 *   punto d'inizio sul dorso, stesso verso): il loft non si attorciglia, anche fra tappo tondo e seduta a scudo;
 * - le sezioni salgono oltre la seduta (scorta) e la seduta si taglia con tre utensili: la superficie scavata fra B e
 *   F (loft di parabole), una scatola dietro B sopra l'altezza e il piano inclinato davanti a F;
 * - la cavità di svuotamento (solo a iniezione) si estrae lungo la normale della seduta: superellissi concentriche
 *   parallele alla seduta, ognuna dentro quella sopra (sformo per costruzione) e a una parete dall'esterno (erosione
 *   con una sfera); colonne del perno e dei chiodi = coni paralleli alla normale tolti dalla cavità;
 * - perno d'acciaio sull'asse inclinato della spinta, dal tappo a 6 mm sotto la seduta; fori dei chiodi lungo la normale.
 */

type Lib = typeof Smlib;

const varianti = ['stiletto', 'blocco', 'rocchetto', 'cono', 'kitten'] as const;

/** Versione della ricetta: la 2 disegna dorso e petto separati, la seduta inclinata e scavata. */
const versioneRicetta = 2;

const svuotatoDi = (p: ParametriTacco): boolean =>
  p.costruzione.processo === 'stampaggio_iniezione' && p.seduta.lunghezza * p.seduta.larghezza > 900;

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'tacco.altezza',
    unita: 'mm',
    min: 15,
    max: 130,
    default: 85,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Altezza dal piano d’appoggio al punto posteriore della seduta (si misura dietro)',
  },
  {
    chiave: 'tacco.spinta',
    unita: 'deg',
    min: -2,
    max: 10,
    default: 3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Inclinazione in avanti dell’asse dal tappo al centro della seduta',
  },
  {
    chiave: 'seduta.forma',
    unita: 'enum',
    valori: ['ellisse', 'rettangolo', 'scudo'],
    default: 'scudo',
    fonteDefault: 'mestiere',
    descrizione: 'Pianta della seduta: scudo = dorso tondo, petto dritto',
  },
  {
    chiave: 'seduta.lunghezza',
    unita: 'mm',
    min: 30,
    max: 90,
    default: 55,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Lunghezza della seduta, dal dorso al petto lungo la seduta',
  },
  {
    chiave: 'seduta.larghezza',
    unita: 'mm',
    min: 28,
    max: 75,
    default: 48,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza della seduta (non si vede di fianco)',
  },
  {
    chiave: 'seduta.raggioAngoli',
    unita: 'mm',
    min: 0,
    max: 30,
    default: 12,
    fonteDefault: 'scelta_nostra',
    descrizione: 'Raggio degli angoli verso il petto (rettangolo, scudo)',
  },
  {
    chiave: 'seduta.inclinazione',
    unita: 'deg',
    min: 0,
    max: 35,
    default: 14,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione:
      'Inclinazione della seduta vista di fianco, scende verso la punta: 5–10° nei tacchi bassi, 15–30° negli alti',
  },
  {
    chiave: 'tappo.forma',
    unita: 'enum',
    valori: ['ellisse', 'rettangolo', 'come_seduta'],
    default: 'ellisse',
    fonteDefault: 'mestiere',
    descrizione: 'Forma del tappo',
  },
  {
    chiave: 'tappo.lunghezza',
    unita: 'mm',
    min: 6,
    max: 70,
    default: 10,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Lunghezza del tappo',
  },
  {
    chiave: 'tappo.larghezza',
    unita: 'mm',
    min: 6,
    max: 70,
    default: 10,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza del tappo',
  },
  {
    chiave: 'tappo.altezza',
    unita: 'mm',
    min: 3,
    max: 8,
    default: 5,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore del sopratacco',
  },
  {
    chiave: 'tappo.materiale',
    unita: 'enum',
    valori: ['tpu', 'pu'],
    default: 'tpu',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale del sopratacco',
  },
  {
    chiave: 'vita.quota',
    unita: 'frazione',
    min: 0.2,
    max: 0.8,
    default: 0.55,
    fonteDefault: 'scelta_nostra',
    silhouetteSensibile: true,
    descrizione: 'Quota (0 tappo, 1 seduta) dove il fusto si apre verso la seduta; rocchetto: il punto più stretto',
  },
  {
    chiave: 'vita.scala',
    unita: 'frazione',
    min: 0.2,
    max: 1.2,
    default: 0.3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Spessore del fusto a quella quota rispetto alla seduta (stiletto ≈ 0,3)',
  },
  {
    chiave: 'dorso.bombatura',
    unita: 'mm',
    min: -10,
    max: 15,
    default: 0,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Dorso di fianco: + più pieno verso dietro, − più incavato',
  },
  {
    chiave: 'fronte.bombatura',
    unita: 'mm',
    min: -12,
    max: 10,
    default: 0,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Petto di fianco: − arco più profondo sotto la seduta, + più pieno',
  },
  {
    chiave: 'anima.diametro',
    unita: 'mm',
    min: 0,
    max: 8,
    default: 5,
    fonteDefault: 'mestiere',
    descrizione: 'Perno d’acciaio (0 = assente, altrimenti 3–8)',
  },
  {
    chiave: 'anima.lunghezza',
    unita: 'mm',
    default: 65,
    fonteDefault: 'derivato',
    derivato: (p) => assePerno(p as ParametriTacco).lunghezza,
    descrizione: 'Dal tappo (2 mm dentro) a 6 mm sotto la seduta',
  },
  {
    chiave: 'fori.numero',
    unita: 'n',
    min: 0,
    max: 4,
    default: 3,
    fonteDefault: 'mestiere',
    descrizione: 'Fori di fissaggio sulla seduta',
  },
  {
    chiave: 'fori.diametro',
    unita: 'mm',
    min: 2,
    max: 4.5,
    default: 3.2,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro dei fori di fissaggio',
  },
  {
    chiave: 'costruzione.processo',
    unita: 'enum',
    valori: ['stampaggio_iniezione', 'cnc', 'stampa_3d_resina'],
    default: 'stampaggio_iniezione',
    fonteDefault: 'mestiere',
    descrizione: 'Processo produttivo',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['abs', 'pa6', 'pa_gf30', 'pu', 'legno_faggio', 'alluminio'],
    default: 'abs',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale del corpo',
  },
  {
    chiave: 'costruzione.parete',
    unita: 'mm',
    min: 1.5,
    max: 4,
    default: 2.2,
    fonteDefault: 'mestiere',
    descrizione: 'Parete dello svuotamento (ABS)',
  },
  {
    chiave: 'costruzione.sformo',
    unita: 'deg',
    min: 0.5,
    max: 3,
    default: 1.5,
    fonteDefault: 'mestiere',
    descrizione: 'Sformo della cavità (estratta perpendicolare alla seduta)',
  },
  {
    chiave: 'costruzione.svuotato',
    unita: 'bool',
    default: true,
    fonteDefault: 'derivato',
    derivato: (p) => svuotatoDi(p as ParametriTacco),
    descrizione: 'Svuotato dal lato seduta (iniezione e seduta oltre 900 mm²)',
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

const sostituzioniVariante: Readonly<Record<VarianteTacco, Readonly<Record<string, number | string>>>> = {
  stiletto: {},
  blocco: {
    'tacco.altezza': 60,
    'tacco.spinta': 0,
    'seduta.inclinazione': 8,
    'tappo.forma': 'come_seduta',
    'tappo.lunghezza': 49,
    'tappo.larghezza': 42,
    'vita.scala': 1,
    'anima.diametro': 0,
    'fori.numero': 4,
  },
  rocchetto: {
    'tacco.altezza': 55,
    'tacco.spinta': 2,
    'seduta.inclinazione': 10,
    'tappo.lunghezza': 26,
    'tappo.larghezza': 26,
    'vita.quota': 0.42,
    'vita.scala': 0.32,
    'anima.diametro': 0,
  },
  cono: {
    'tacco.altezza': 45,
    'tacco.spinta': 2,
    'seduta.inclinazione': 8,
    'tappo.lunghezza': 20,
    'tappo.larghezza': 20,
    'anima.diametro': 0,
  },
  kitten: {
    'tacco.altezza': 40,
    'seduta.lunghezza': 50,
    'seduta.larghezza': 44,
    'seduta.inclinazione': 6,
    'tappo.lunghezza': 11,
    'tappo.larghezza': 11,
    'vita.quota': 0.45,
    'vita.scala': 0.32,
    'anima.diametro': 0,
  },
};

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteTacco =>
  varianti.includes(opzioni?.variante as VarianteTacco) ? (opzioni!.variante as VarianteTacco) : 'stiletto';

const predefiniti = (variante?: string): ParametriTacco =>
  predefinitiDaParametri<ParametriTacco>(parametri, sostituzioniVariante[varianteDi({ variante })]);

const spostamentoTappo = (p: ParametriTacco): number =>
  (p.tacco.altezza - p.tappo.altezza) * Math.tan(radianti(p.tacco.spinta));

const vincoli = (p: ParametriTacco): Array<{ chiave: string; messaggio: string }> => {
  const violati: Array<{ chiave: string; messaggio: string }> = [];
  const { tacco, seduta, tappo, vita, anima, costruzione } = p;
  if (tappo.lunghezza > seduta.lunghezza || tappo.larghezza > seduta.larghezza) {
    violati.push({ chiave: 'tappo.lunghezza', messaggio: 'Il tappo è più grande della seduta.' });
  }
  if (tacco.altezza - tappo.altezza < 10) {
    violati.push({ chiave: 'tacco.altezza', messaggio: 'Meno di 10 mm di corpo sopra il tappo.' });
  }
  if (anima.diametro > 0 && Math.min(tappo.lunghezza, tappo.larghezza) - anima.diametro < 3) {
    violati.push({ chiave: 'anima.diametro', messaggio: 'Meno di 1,5 mm di parete attorno al perno nel tappo.' });
  }
  if (anima.diametro > 0 && anima.diametro < 3) {
    violati.push({ chiave: 'anima.diametro', messaggio: 'Il perno va da 3 a 8 mm (0 = assente).' });
  }
  // Il vincolo non conosce la variante: vale il limite del rocchetto, il più largo (`normalizza` applica quello giusto).
  if (vita.scala * seduta.larghezza < tappo.larghezza * strettezzaVita('rocchetto') - 1e-9) {
    violati.push({ chiave: 'vita.scala', messaggio: 'La vita è troppo stretta rispetto al tappo.' });
  }
  if (Math.abs(spostamentoTappo(p)) > (seduta.lunghezza * Math.cos(radianti(seduta.inclinazione))) / 2) {
    violati.push({
      chiave: 'tacco.spinta',
      messaggio: 'Con questa spinta il tappo esce dalla proiezione della seduta.',
    });
  }
  if (seduta.inclinazione > inclinazioneMassima(p) + 1e-9) {
    violati.push({
      chiave: 'seduta.inclinazione',
      messaggio: 'Con questa inclinazione il punto anteriore della seduta scende troppo vicino al tappo.',
    });
  }
  const legno = costruzione.materiale === 'legno_faggio' || costruzione.materiale === 'alluminio';
  if ((costruzione.processo === 'cnc') !== legno) {
    violati.push({
      chiave: 'costruzione.materiale',
      messaggio: 'CNC: legno o alluminio; iniezione e resina: polimeri.',
    });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriTacco => {
  const variante = varianteDi(opzioni);
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(variante));
  const { tacco, seduta, tappo, vita, anima, costruzione } = p;
  // (1) Tappo dentro la seduta.
  tappo.lunghezza = Math.min(tappo.lunghezza, seduta.lunghezza);
  tappo.larghezza = Math.min(tappo.larghezza, seduta.larghezza);
  // (2) Almeno 10 mm di corpo.
  tacco.altezza = Math.max(tacco.altezza, tappo.altezza + 10);
  // (3) Perno: 0 oppure 3–8, con 1,5 mm di parete nel tappo.
  if (anima.diametro > 0) {
    anima.diametro = Math.max(3, anima.diametro);
    if (Math.min(tappo.lunghezza, tappo.larghezza) - anima.diametro < 3) {
      anima.diametro =
        Math.min(tappo.lunghezza, tappo.larghezza) - 3 >= 3 ? Math.min(tappo.lunghezza, tappo.larghezza) - 3 : 0;
    }
  }
  // (4) Vita non più stretta del tappo oltre il 20 % (il rocchetto, che si riapre verso terra, fino al 55 %).
  vita.scala = limita(Math.max(vita.scala, (tappo.larghezza * strettezzaVita(variante)) / seduta.larghezza), 0.2, 1.2);
  // (5) Seduta: il punto anteriore resta ben sopra il tappo.
  seduta.inclinazione = Math.min(seduta.inclinazione, inclinazioneMassima(p));
  // (6) Spinta: il tappo resta sotto la seduta.
  const pianta = seduta.lunghezza * Math.cos(radianti(seduta.inclinazione));
  const massima = (Math.atan(pianta / 2 / (tacco.altezza - tappo.altezza)) * 180) / Math.PI;
  tacco.spinta = limita(tacco.spinta, -massima, massima);
  // (7) La vita sta sotto il punto anteriore della seduta, così il petto ha spazio per aprirsi.
  if (haFusto(variante)) {
    const corpo = tacco.altezza - tappo.altezza;
    const quota = (quotaMassimaVita(p) - tappo.altezza) / corpo;
    // Continuo, senza arrotondare: la verifica D3 muove questi valori e un gradino sarebbe un piano per il simplesso.
    vita.quota = limita(Math.min(vita.quota, quota), 0.2, 0.8);
  }
  // Materiale coerente col processo.
  const legno = costruzione.materiale === 'legno_faggio' || costruzione.materiale === 'alluminio';
  if (costruzione.processo === 'cnc' && !legno) {
    costruzione.materiale = 'legno_faggio';
  } else if (costruzione.processo !== 'cnc' && legno) {
    costruzione.materiale = 'abs';
  }
  return p;
};

/**
 * I punti del contorno per la spline chiusa di una sezione: 16 bastano alla superellisse (stesso volume entro lo 0,1 %),
 * e con 24 le booleane sul loft costano tre volte tanto.
 */
const puntiContorno = 16;

/** Il bordo chiuso di una sezione orizzontale (spline per i punti del contorno), alla sua quota. */
function bordoSezione(lib: Lib, sezione: SezioneTacco): Smlib.Edge {
  // Il loft accetta il bordo chiuso così com'è: farne prima una faccia costa 1,5 ms a sezione.
  return lib.Pos(0, 0, sezione.z).mul(lib.Spline(contornoSezione(sezione, puntiContorno), { closed: true }));
}

/**
 * Una forma disegnata nel telaio della seduta (x, s sul piano XY, la normale della seduta lungo +Z), posata sul piano
 * parallelo alla seduta a profondità h.
 * @param lib - Libreria SMLib.
 * @param seduta - La seduta del profilo.
 * @param posa - La forma e la profondità sotto il piano della seduta.
 * @returns La forma posata.
 */
function posaInSeduta(lib: Lib, seduta: SedutaTacco, posa: { forma: Smlib.Sketch; h: number }): Smlib.Sketch;
function posaInSeduta(lib: Lib, seduta: SedutaTacco, posa: { forma: Smlib.Part; h: number }): Smlib.Part;
function posaInSeduta(
  lib: Lib,
  seduta: SedutaTacco,
  posa: { forma: Smlib.Sketch | Smlib.Part; h: number },
): Smlib.Sketch | Smlib.Part {
  const [y, z] = puntoDaSeduta(seduta, 0, posa.h);
  const luogo = lib.Pos(0, y, z).mul(lib.Rot((-seduta.inclinazione * 180) / Math.PI, 0, 0));
  return posa.forma instanceof lib.Part ? luogo.mul(posa.forma) : luogo.mul(posa.forma);
}

/** Il loft di bordi chiusi è un solido: lo dice il tipo (`loft` di bordi può dare anche un guscio, qui mai). */
function loftSolido(
  lib: Lib,
  bordi: readonly Smlib.Edge[],
  opzioni: { smooth?: boolean; ruled?: boolean },
): Smlib.Part {
  const solido = lib.loft(bordi, opzioni);
  if (!(solido instanceof lib.Part)) {
    throw new TypeError('Il loft delle sezioni del tacco non ha chiuso un solido.');
  }
  return solido;
}

/** La normale della seduta (in alto e in avanti): la direzione in cui si estrae la cavità. */
const normaleSeduta = (seduta: SedutaTacco): [number, number, number] => [
  0,
  Math.sin(seduta.inclinazione),
  Math.cos(seduta.inclinazione),
];

/**
 * L'utensile che taglia la seduta dalla scorta sopra: un loft di sezioni trasversali (piani y = cost.) con il fondo a
 * parabola, da poco dietro B fin oltre la scorta del petto. Il fondo è la seduta scavata fra B e F e il suo piano fuori
 * (l'incavo è nullo e piatto in B e in F: niente spigoli nel loft); un solo utensile, niente contatti al limite fra
 * utensili diversi nel punto B o F.
 */
function utensileSeduta(lib: Lib, profilo: ProfiloTacco, larghezza: number): Smlib.Part {
  const { seduta } = profilo;
  const [yB] = seduta.dorso;
  const [yF] = seduta.petto;
  const fuori = larghezza / 2 + 12;
  const cima = profilo.tetto + 10;
  const lunghezza = yF - yB;
  const ultimo = profilo.sezioni.at(-1)!;
  // Fin oltre la punta della scorta del petto (sopra la seduta prosegue sulla sua tangente).
  const uOltre = Math.max(1.2, (ultimo.petto - yB + 3) / lunghezza);
  // Con una sezione proprio in B (u = 0) e in F (u = 1): lì la superficie passa esatta per l'altezza e per il petto.
  const quote = [-0.05, 0, 0.25, 0.5, 0.75, 1, uOltre];
  const sezioni = quote.map((u) => {
    const y = yB + u * lunghezza;
    const centro = quotaSeduta(seduta, larghezza, [0, y]);
    // Fondo z = centro + k·x²: la parabola trasversale dell'incavo, nulla fuori da B…F.
    const k =
      (profonditaIncavo(seduta, larghezza, [0, y]) - profonditaIncavo(seduta, larghezza, [larghezza / 2, y])) /
      (larghezza / 2) ** 2;
    const lato = centro + k * fuori * fuori;
    const filo = new lib.Wire([
      lib.Bezier([-fuori, lato], [0, centro - k * fuori * fuori], [fuori, lato]),
      lib.Line([fuori, lato], [fuori, cima]),
      lib.Line([fuori, cima], [-fuori, cima]),
      lib.Line([-fuori, cima], [-fuori, lato]),
    ]);
    // Disegnata su XY con (x, z) e girata di 90° attorno a X: (x, v, 0) → (x, 0, v).
    return lib.Pos(0, y, 0).mul(lib.Rot(90, 0, 0).mul(lib.makeFace(filo)));
  });
  return lib.loft(sezioni, { smooth: true });
}

/** Posizioni dei fori di fissaggio nel telaio della seduta [x, s] (§1.1, passo 9), attorno al centro della seduta. */
function posizioniFori(lib: Lib, p: ParametriTacco): Array<[number, number]> {
  const { numero } = p.fori;
  const { lunghezza, larghezza } = p.seduta;
  const centro = lunghezza / 2;
  if (numero <= 0) {
    return [];
  }
  if (numero === 1) {
    return [[0, centro]];
  }
  if (numero === 2) {
    return [
      [0, centro + lunghezza * 0.175],
      [0, centro - lunghezza * 0.175],
    ];
  }
  const posizioni =
    numero === 3
      ? lib.PolarLocations(larghezza * 0.25, 3, { startAngle: 90 })
      : lib.GridLocations(larghezza * 0.3, lunghezza * 0.35, 2, 2);
  return posizioni.points.map((punto) => [punto.x, centro + punto.y]);
}

/** Profondità minima della cavità sotto il piano della seduta (mm). */
const profonditaMinimaCavita = 10;

/** Una colonna (perno o chiodo): asse parallelo alla normale della seduta in (x, s), raggio in cima. */
type Colonna = { x: number; s: number; raggio: number };

/** Il raggio di una colonna alla profondità h: si allarga scendendo dello sformo (più la deriva del perno). */
const raggioColonna = (colonna: Colonna, h: number, crescita: number): number =>
  colonna.raggio + Math.max(0, h + 1.5) * crescita;

/** Se un cerchio (x, s, r) sta nella sezione della cavità con 0,8 mm di margine. */
function cerchioInCavita(cavita: CavitaTacco, indice: number, cerchio: { x: number; s: number; r: number }): boolean {
  const sezione = sezioneDiCavita(cavita, cavita.sezioni[indice]!);
  return Array.from({ length: 16 }, (_, k) => (k * Math.PI) / 8).every((angolo) =>
    dentroSezione(sezione, [
      cerchio.x + (cerchio.r + 0.8) * Math.cos(angolo),
      cerchio.s + (cerchio.r + 0.8) * Math.sin(angolo),
    ]),
  );
}

type Svuotamento = { cavita?: Smlib.Part; fori: Array<[number, number]>; colonnaPerno?: Colonna };

/**
 * La cavità di svuotamento dal lato seduta con le colonne del perno e dei chiodi. I chiodi si avvicinano al centro
 * finché la loro colonna sta nella cavità senza toccare quella del perno; se non ci stanno restano fuori.
 */
function costruisciCavita(
  lib: Lib,
  p: ParametriTacco,
  contesto: { profilo: ProfiloTacco; esiti: Esito[] },
): Svuotamento {
  const { profilo, esiti } = contesto;
  const { seduta } = profilo;
  const { costruzione, anima } = p;
  const fori = posizioniFori(lib, p);
  const corpo = p.tacco.altezza - p.tappo.altezza;
  const zPetto = seduta.petto[1];
  const quotaMinima =
    profilo.vita === undefined ? p.tappo.altezza + 0.4 * corpo : profilo.vita + 0.25 * (zPetto - profilo.vita);
  const cavita = cavitaTacco(p, profilo, { quotaMinima });
  if (!cavita) {
    esiti.push(
      esito('info', 'SVUOTAMENTO', { messaggio: 'Seduta troppo stretta per la cavità: tacco pieno.', pezzo: 'Tacco' }),
    );
    return { fori };
  }
  const tanSformo = Math.tan(radianti(costruzione.sformo + 0.5));
  const perno = assePerno(p);
  // Il perno, nel telaio della seduta: dove passa in cima alla cavità e quanto deriva per mm di profondità.
  const pernoIn = (h: number): [number, number] => {
    const [s0, h0] = sedutaDaPunto(seduta, perno.base);
    const [s1, h1] = sedutaDaPunto(seduta, [
      perno.base[0] + perno.direzione[0] * perno.lunghezza,
      perno.base[1] + perno.direzione[1] * perno.lunghezza,
    ]);
    return [0, s0 + ((s1 - s0) * (h - h0)) / (h1 - h0)];
  };
  const derivaPerno = (() => {
    const [, sa] = pernoIn(0);
    const [, sb] = pernoIn(10);
    return Math.abs(sb - sa) / 10;
  })();
  const colonnaPerno: Colonna | undefined =
    anima.diametro > 0
      ? { x: 0, s: pernoIn(-1.5)[1], raggio: anima.diametro / 2 + 0.1 + costruzione.parete }
      : undefined;
  const crescitaPerno = tanSformo + derivaPerno;
  const colonnaChiodo = (x: number, s: number): Colonna => ({ x, s, raggio: p.fori.diametro / 2 + costruzione.parete });
  type Elenco = ReadonlyArray<{ colonna: Colonna; crescita: number }>;
  /** Se le colonne stanno, separate di 1,5 mm, nella sezione `indice` della cavità. */
  const stannoA = (indice: number, elenco: Elenco): boolean => {
    const { h } = cavita.sezioni[indice]!;
    const cerchi = elenco.map(({ colonna, crescita }) => ({
      x: colonna.x,
      s: colonna.s,
      r: raggioColonna(colonna, h, crescita),
    }));
    const separati = cerchi.every((a, i) =>
      cerchi.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.s - b.s) >= a.r + b.r + 1.5),
    );
    return separati && cerchi.every((cerchio) => cerchioInCavita(cavita, indice, cerchio));
  };
  /** L'ultima sezione (dall'alto) fin dove le colonne stanno tutte; −1 se non stanno nemmeno in cima. */
  const fondoPer = (elenco: Elenco): number => {
    let fondo = -1;
    for (let indice = 0; indice < cavita.sezioni.length && stannoA(indice, elenco); indice++) {
      fondo = indice;
    }
    return fondo;
  };
  const conPerno = colonnaPerno ? [{ colonna: colonnaPerno, crescita: crescitaPerno }] : [];
  // La colonna del perno si allarga scendendo e la cavità si stringe: la cavità si ferma dove la colonna ci sta ancora.
  const fondoPerno = colonnaPerno ? fondoPer(conPerno) : cavita.sezioni.length - 1;
  if (fondoPerno < 0 || cavita.sezioni[fondoPerno]!.h < 4) {
    esiti.push(
      esito('info', 'SVUOTAMENTO', {
        messaggio: 'La colonna del perno non lascia spazio alla cavità: tacco pieno.',
        pezzo: 'Tacco',
      }),
    );
    return { fori, ...(colonnaPerno ? { colonnaPerno } : {}) };
  }
  // I chiodi: le posizioni della ricetta, poi più vicine al centro (a passi del 10 %); con il perno, anche in giro
  // attorno alla sua colonna. Si tiene il primo giro che lascia la cavità profonda almeno la metà di quella senza chiodi;
  // se nessuno ci riesce, quello che la lascia più profonda (almeno 4 mm): meglio una cavità più bassa che niente chiodi.
  const profonditaDi = (fondo: number): number => (fondo < 0 ? 0 : cavita.sezioni[fondo]!.h);
  const centro = p.seduta.lunghezza / 2;
  const candidati: Array<{ posizioni: Array<[number, number]>; nota?: string }> = [];
  for (let fattore = 1; fattore >= 0.45; fattore -= 0.1) {
    candidati.push({
      posizioni: fori.map(([x, s]) => [x * fattore, centro + (s - centro) * fattore]),
      ...(fattore < 1 ? { nota: `avvicinati al centro (${Math.round(fattore * 100)} %)` } : {}),
    });
  }
  if (colonnaPerno && fori.length >= 2) {
    const separazione = colonnaPerno.raggio + p.fori.diametro / 2 + costruzione.parete + 2.5;
    for (const inizio of [-90, 90]) {
      for (let raggio = p.seduta.larghezza * 0.25; raggio >= separazione - 1e-9; raggio -= 1) {
        candidati.push({
          posizioni: Array.from({ length: fori.length }, (_, k) => {
            const angolo = radianti(inizio + (360 * k) / fori.length);
            return [raggio * Math.cos(angolo), colonnaPerno.s + raggio * Math.sin(angolo)];
          }),
          nota: `attorno al perno a ${mm(raggio, 1)}`,
        });
      }
    }
    // Ultima scelta: la vite centrale entra nella colonna del perno, sopra la sua testa; i chiodi restano fuori.
    candidati.push({ posizioni: [], nota: 'ridotti alla vite centrale nella colonna del perno' });
  }
  const conChiodi = (posizioni: ReadonlyArray<[number, number]>): Elenco => [
    ...conPerno,
    ...posizioni.map(([x, s]) => ({ colonna: colonnaChiodo(x, s), crescita: tanSformo })),
  ];
  const valutati = (fori.length > 0 ? candidati : []).map((candidato) => ({
    ...candidato,
    profondita: profonditaDi(fondoPer(conChiodi(candidato.posizioni))),
  }));
  const piuProfondo = valutati
    .filter(({ posizioni }) => posizioni.length > 0)
    .toSorted((a, b) => b.profondita - a.profondita)[0];
  const sogliaProfondita = 0.5 * profonditaDi(fondoPerno);
  const scelto =
    valutati.find(({ profondita }) => profondita > 0 && profondita >= sogliaProfondita) ??
    (piuProfondo && piuProfondo.profondita >= 4
      ? { ...piuProfondo, nota: `${piuProfondo.nota ?? 'nelle posizioni della ricetta'}, con la cavità più bassa` }
      : undefined);
  const foriTenuti: Array<[number, number]> = scelto
    ? scelto.posizioni.length > 0
      ? scelto.posizioni
      : colonnaPerno
        ? [[0, colonnaPerno.s]]
        : []
    : [];
  if (scelto?.nota) {
    esiti.push(
      esito('info', 'FORI_SPOSTATI', {
        messaggio: `Fori di fissaggio ${scelto.nota}: così le colonne stanno nella cavità.`,
        pezzo: 'Tacco',
      }),
    );
  }
  if (fori.length > 0 && foriTenuti.length === 0) {
    esiti.push(
      esito('avviso', 'FORO_FUORI', {
        messaggio: 'Le colonne dei fori non stanno nella cavità: fori tolti, fissaggio da definire.',
        pezzo: 'Tacco',
      }),
    );
  }
  const vitePerno =
    colonnaPerno !== undefined &&
    foriTenuti.length === 1 &&
    Math.abs(foriTenuti[0]![0]) < 1e-9 &&
    Math.abs(foriTenuti[0]![1] - colonnaPerno.s) < 1e-9;
  const colonne = conChiodi(vitePerno ? [] : foriTenuti);
  const ultima = Math.max(0, fondoPer(colonne));
  // Una cavità più bassa di 10 mm sotto la seduta toglie poco materiale e aggiunge un'anima allo stampo (e la booleana
  // più cara della ricetta): il tacco resta pieno, i fori di fissaggio restano.
  if (cavita.sezioni[ultima]!.h < profonditaMinimaCavita) {
    esiti.push(
      esito('info', 'SVUOTAMENTO', {
        messaggio: `Cavità possibile solo per ${mm(cavita.sezioni[ultima]!.h, 0)} sotto la seduta: tacco pieno.`,
        pezzo: 'Tacco',
      }),
    );
    return { fori: foriTenuti, ...(colonnaPerno ? { colonnaPerno } : {}) };
  }
  // Le sezioni del loft: da 4 a 6, equidistanti in profondità, sempre la prima e l'ultima (la cavità è liscia: di più
  // costano nelle booleane senza cambiare la forma).
  const quante = limita(Math.round(cavita.sezioni[ultima]!.h / 8) + 1, 4, 6);
  const indici = [...new Set(Array.from({ length: quante }, (_, k) => Math.round((k * ultima) / (quante - 1))))];
  // Le colonne sono fori delle sezioni (un loft di sezioni con fori fa un solido cavo): crescono scendendo con lo
  // sformo, quindi escono già sformate e senza una booleana in più.
  const schizzi = indici.map((indice) => {
    const sezione = cavita.sezioni[indice]!;
    const bordo = lib.Spline(contornoSezione(sezioneDiCavita(cavita, sezione), puntiContorno), { closed: true });
    const cerchi = colonne.map(({ colonna, crescita }) =>
      lib.Pos(colonna.x, colonna.s).mul(lib.Circle(raggioColonna(colonna, sezione.h, crescita))),
    );
    // Un taglio solo con l'unione dei cerchi: metà del tempo di una faccia con i fori uno per uno.
    const faccia = lib.makeFace(bordo);
    const schizzo =
      cerchi.length === 0 ? faccia : faccia.cut(cerchi.length === 1 ? cerchi[0]! : cerchi[0]!.fuse(...cerchi.slice(1)));
    return posaInSeduta(lib, seduta, { forma: schizzo, h: sezione.h });
  });
  // Rigata, a tratti dritti fra sezioni annidate: lo sformo resta positivo per costruzione (un loft liscio, dove il
  // tacco si apre forte sotto una seduta inclinata, ondeggia fra le sezioni e va in sottosquadro).
  const solido = lib.loft(schizzi, { ruled: true });
  return { cavita: solido, fori: foriTenuti, ...(colonnaPerno ? { colonnaPerno } : {}) };
}

/**
 * Toglie gli strumenti dal corpo con una sola booleana; se il kernel la rifiuta li applica uno alla volta e scarta
 * quello che fallisce, con un avviso pulito al posto dell'errore: il tacco si costruisce comunque, più pieno del previsto.
 * @param corpo - Il corpo.
 * @param taglio - Gli strumenti, gli esiti dove scrivere l'avviso e chi avvisare dello strumento scartato.
 * @returns Il corpo tagliato.
 */
function tagliaConRiserva(
  corpo: Smlib.Part,
  taglio: { strumenti: readonly Smlib.Part[]; esiti: Esito[]; scartato: (strumento: Smlib.Part) => void },
): Smlib.Part {
  const { strumenti, esiti, scartato } = taglio;
  try {
    return corpo.cut(...strumenti);
  } catch {
    // Uno alla volta, qui sotto.
  }
  let risultato = corpo;
  for (const strumento of strumenti) {
    try {
      risultato = risultato.cut(strumento);
    } catch {
      scartato(strumento);
      esiti.push(
        esito('avviso', 'SVUOTAMENTO', {
          messaggio: 'Una cavità o un foro non si costruiscono con questi valori: il tacco resta pieno lì.',
          pezzo: 'Tacco',
        }),
      );
    }
  }
  return risultato;
}

type CorpoTacco = {
  corpo: Smlib.Part;
  cavita: Array<readonly [number, number, number]>;
  anima?: Smlib.Part;
  foroAnima?: Smlib.Part;
};

/** Il perno (o il suo foro, 0,1 mm più largo) lungo l'asse inclinato della spinta. */
function cilindroPerno(lib: Lib, p: ParametriTacco, gioco: number): Smlib.Part {
  const { base, lunghezza } = assePerno(p);
  return lib.Pos(0, base[0], base[1]).mul(
    lib.Rot(-p.tacco.spinta, 0, 0).mul(
      lib.Cylinder(p.anima.diametro / 2 + gioco, lunghezza + gioco, {
        align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN],
      }),
    ),
  );
}

/** Corpo del tacco destro: loft delle sezioni, seduta tagliata, cavità, fori e sede del perno. */
function costruisciCorpo(
  lib: Lib,
  p: ParametriTacco,
  contesto: { variante: VarianteTacco; profilo: ProfiloTacco; esiti: Esito[] },
): CorpoTacco {
  const { profilo, esiti } = contesto;
  const { seduta } = profilo;
  let corpo = loftSolido(
    lib,
    profilo.sezioni.map((sezione) => bordoSezione(lib, sezione)),
    { smooth: true },
  );
  // Nessun raccordo sul bordo verso il tappo: il sopratacco combacia di testa (si rifila in finitura), e sul loft di
  // spline il raccordo costava da solo più di metà della ricostruzione.
  // La seduta: senza questo taglio il tacco non ha la sua forma, quindi un errore qui è un errore della ricetta.
  corpo = corpo.cut(utensileSeduta(lib, profilo, p.seduta.larghezza));
  let svuotamento: Svuotamento = { fori: posizioniFori(lib, p) };
  if (svuotatoDi(p)) {
    try {
      svuotamento = costruisciCavita(lib, p, contesto);
    } catch (error) {
      esiti.push(
        esito('avviso', 'SVUOTAMENTO', {
          messaggio: `Cavità non costruita (${(error as Error).message}): tacco pieno.`,
          pezzo: 'Tacco',
        }),
      );
    }
  }
  const { cavita } = svuotamento;
  const strumenti: Smlib.Part[] = cavita ? [cavita] : [];
  const perno = p.anima.diametro > 0 ? assePerno(p) : undefined;
  for (const [x, s] of svuotamento.fori) {
    const [y] = puntoDaSeduta(seduta, s, 0);
    const superficie = quotaSeduta(seduta, p.seduta.larghezza, [x, y]);
    const [, zPiano] = puntoDaSeduta(seduta, s, 0);
    const scavo = Math.max(0, zPiano - superficie);
    // Sull'asse del perno la vite si ferma 1 mm sopra la sua testa.
    const sulPerno =
      svuotamento.colonnaPerno !== undefined &&
      Math.hypot(x - svuotamento.colonnaPerno.x, s - svuotamento.colonnaPerno.s) < 1e-6;
    const testaPerno = perno ? perno.base[1] + perno.direzione[1] * perno.lunghezza : 0;
    // Il foro scende al più fin dove resta a una parete dalla superficie esterna (sotto una cavità bassa il tacco
    // si stringe: un foro di 14 mm uscirebbe dal fianco).
    const sicura = profonditaForo(profilo, {
      x,
      s,
      raggio: p.fori.diametro / 2,
      parete: Math.min(p.costruzione.parete, 1.5),
      massima: scavo + 14,
    });
    const utile = Math.min(sulPerno ? Math.max(3, Math.min(14, superficie - testaPerno - 1)) : 14, sicura - scavo);
    if (utile < 3) {
      esiti.push(
        esito('avviso', 'FORO_FUORI', {
          messaggio: 'Un foro di fissaggio uscirebbe dal fianco del tacco: tolto, fissaggio da definire.',
          pezzo: 'Tacco',
        }),
      );
      continue;
    }
    const lunghezza = 2 + scavo + utile;
    const cilindro = lib.Cylinder(p.fori.diametro / 2, lunghezza, {
      align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX],
    });
    // Lungo la normale della seduta, dalla cima 2 mm sopra il piano.
    strumenti.push(posaInSeduta(lib, seduta, { forma: lib.Pos(x, s, 0).mul(cilindro), h: -2 }));
  }
  let pernoPezzo: Smlib.Part | undefined;
  let foroAnima: Smlib.Part | undefined;
  if (perno && perno.lunghezza > 0) {
    pernoPezzo = cilindroPerno(lib, p, 0);
    foroAnima = cilindroPerno(lib, p, 0.1);
    strumenti.push(foroAnima);
  }
  let cavitaTenuta = cavita;
  if (strumenti.length > 0) {
    corpo = tagliaConRiserva(corpo, {
      strumenti,
      esiti,
      scartato: (scartato) => {
        if (scartato === cavita) {
          cavitaTenuta = undefined;
        }
      },
    });
  }
  const cavitaPunti = cavitaTenuta ? puntiDiFacce(corpo.faces().derivedFrom(cavitaTenuta)) : [];
  if (!corpo.isValid()) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', { messaggio: 'Il corpo del tacco non è un solido valido.', pezzo: 'Tacco' }),
    );
  }
  return {
    corpo: normalizzaForma(lib, corpo),
    cavita: cavitaPunti,
    ...(pernoPezzo ? { anima: pernoPezzo } : {}),
    ...(foroAnima ? { foroAnima } : {}),
  };
}

/**
 * Il sopratacco: la pianta della prima sezione estrusa per la sua altezza, con uno smusso sul bordo a terra.
 * @param lib - Libreria SMLib.
 * @param p - I parametri.
 * @param tappo - Il profilo del tacco e il foro del perno, se c'è.
 * @returns Il sopratacco.
 */
function costruisciTappo(
  lib: Lib,
  p: ParametriTacco,
  { profilo, foroAnima }: { profilo: ProfiloTacco; foroAnima: Smlib.Part | undefined },
): Smlib.Part {
  const { tappo } = p;
  // Smusso del bordo a terra come loft di tre sezioni (la prima rientrata): costa un decimo del raccordo sul bordo spline.
  const smusso = Math.min(0.8, 0.45 * tappo.altezza, 0.2 * Math.min(tappo.larghezza, tappo.lunghezza));
  const sezione = (z: number, rientro: number): Smlib.Edge =>
    bordoSezione(lib, {
      ...profilo.tappo,
      z,
      dorso: profilo.tappo.dorso + rientro,
      petto: profilo.tappo.petto - rientro,
      larghezza: profilo.tappo.larghezza - 2 * rientro,
    });
  const pezzo = loftSolido(lib, [sezione(0, smusso), sezione(smusso, 0), sezione(tappo.altezza, 0)], { ruled: true });
  return normalizzaForma(lib, foroAnima ? pezzo.cut(foroAnima) : pezzo);
}

function costruisciConEsiti(lib: Lib, p: ParametriTacco, opzioni?: OpzioniFamiglia): RisultatoCostruzione {
  const variante = varianteDi(opzioni);
  const esiti: Esito[] = [];
  const destri: PezzoFamiglia[] = [];
  try {
    const profilo = profiloTacco(p, variante);
    const { corpo, cavita, anima, foroAnima } = misuraPezzo('Tacco', () =>
      costruisciCorpo(lib, p, { variante, profilo, esiti }),
    );
    if (cavita.length > 0) {
      marcaFacce(corpo, 'cavita', cavita);
    }
    destri.push({
      name: 'Tacco DX',
      shape: corpo,
      ruolo: 'corpo',
      materiale: p.costruzione.materiale,
      ...aspettoMateriale(p.costruzione.materiale),
    });
    destri.push({
      name: 'Tappo DX',
      shape: misuraPezzo('Tappo', () => costruisciTappo(lib, p, { profilo, foroAnima })),
      ruolo: 'tappo',
      materiale: p.tappo.materiale,
      ...aspettoMateriale(p.tappo.materiale),
    });
    if (anima) {
      destri.push({
        name: 'Anima DX',
        shape: normalizzaForma(lib, anima),
        ruolo: 'anima',
        materiale: 'acciaio',
        ...aspettoMateriale('acciaio'),
      });
    }
  } catch {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', {
        messaggio: `Il tacco non si costruisce con questi valori (il kernel non chiude il solido): provare un'altezza o una seduta diverse.`,
        pezzo: 'Tacco',
      }),
    );
    return { pezzi: [], esiti };
  }
  const { lato } = p.costruzione;
  if (lato === 'dx') {
    return { pezzi: destri, esiti };
  }
  const specchia = (pezzo: PezzoFamiglia, scostamento: number): PezzoFamiglia => {
    const forma = pezzo.shape as Smlib.Part;
    const specchiata = normalizzaForma(
      lib,
      (scostamento === 0 ? forma : forma.translate(scostamento, 0, 0)).mirror(lib.Plane.YZ),
    );
    trasportaMarcatori(forma, specchiata, ([x, y, z]) => [-(x + scostamento), y, z]);
    return { ...pezzo, name: pezzo.name.replace(/DX$/, 'SX'), shape: specchiata };
  };
  if (lato === 'sx') {
    return { pezzi: destri.map((pezzo) => specchia(pezzo, 0)), esiti };
  }
  // Coppia affiancata come nella scatola: destro verso +X, sinistro speculare verso −X.
  const scostamento = p.seduta.larghezza / 2 + 12;
  const spostati = destri.map((pezzo) => {
    const forma = pezzo.shape as Smlib.Part;
    const spostata = forma.translate(scostamento, 0, 0);
    trasportaMarcatori(forma, spostata, ([x, y, z]) => [x + scostamento, y, z]);
    return { ...pezzo, shape: spostata };
  });
  return { pezzi: [...spostati, ...destri.map((pezzo) => specchia(pezzo, scostamento))], esiti };
}

/** Parete minima del tacco per materiale e processo (§1.1: ABS/PA 1,8 · PU 2,0 · legno 6 · resina 1,0). */
const sogliaPareteTacco = (processo: Processo, materiale: string): number => {
  if (processo === 'cnc') {
    return materiale === 'alluminio' ? 0.8 : 6;
  }
  if (processo === 'stampa_3d_resina') {
    return 1;
  }
  return materiale === 'pu' ? 2 : 1.8;
};

/** Distanza minima del perno dalla superficie esterna, sezione per sezione (contorno della legge). */
function distanzaPerno(p: ParametriTacco, profilo: ProfiloTacco): number {
  const perno = assePerno(p);
  let minima = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= 32; k++) {
    const lungo = (k / 32) * perno.lunghezza;
    const y = perno.base[0] + perno.direzione[0] * lungo;
    const z = perno.base[1] + perno.direzione[1] * lungo;
    if (z < p.tappo.altezza) {
      continue;
    }
    const contorno = contornoSezione(profilo.sezioneA(z), 96);
    const distanza = Math.min(...contorno.map(([cx, cy]) => Math.hypot(cx, cy - y)));
    minima = Math.min(minima, distanza - p.anima.diametro / 2);
  }
  return minima;
}

// oxlint-disable-next-line eslint/max-params -- firma del contratto delle famiglie (§1.0): lib, pezzi, parametri, processo, opzioni.
function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriTacco,
  processo: Processo = p.costruzione.processo,
  opzioni?: OpzioniFamiglia,
): Esito[] {
  const variante = varianteDi(opzioni);
  const esiti: Esito[] = [];
  const corpo = pezzi.find((pezzo) => pezzo.ruolo === 'corpo');
  const punti = corpo ? puntiMarcati(corpo.shape, 'cavita') : undefined;
  if (corpo?.shape instanceof lib.Part && punti && punti.length > 0) {
    const facce = facceAiPunti(corpo.shape, punti);
    const parete = pareteMinima(corpo.shape, { facce, campioniPerFaccia: 6 });
    esiti.push(
      esitoMinimo('PARETE_MIN', {
        valore: parete.min,
        soglia: sogliaPareteTacco(processo, p.costruzione.materiale),
        cosa: 'Parete della cavità',
        pezzo: corpo.name,
      }),
    );
    const minimoSformo = sogliaSformo(processo, p.costruzione.materiale);
    if (minimoSformo !== undefined) {
      esiti.push(
        ...esitiSformo(
          sformo(corpo.shape, { direzione: normaleSeduta(sedutaDi(p)), minimo: minimoSformo - 1e-3, facce }),
          {
            soglia: minimoSformo,
            pezzo: corpo.name,
            dove: 'Cavità (estrazione perpendicolare alla seduta)',
          },
        ),
      );
    }
  } else {
    esiti.push(
      esito('info', 'PARETE_MIN', {
        messaggio: 'Tacco pieno: nessuna parete di svuotamento da misurare.',
        ...(corpo ? { pezzo: corpo.name } : {}),
      }),
    );
  }
  if ((variante === 'stiletto' || variante === 'kitten') && Math.min(p.tappo.lunghezza, p.tappo.larghezza) < 8) {
    esiti.push(
      esito('avviso', 'TAPPO_MIN', {
        messaggio: `Tappo di ${mm(Math.min(p.tappo.lunghezza, p.tappo.larghezza))}: sotto 8 mm consuma presto.`,
        soglia: 8,
      }),
    );
  }
  const animaNecessaria =
    p.tacco.altezza > 60 && (variante === 'stiletto' || variante === 'kitten' || variante === 'rocchetto');
  if (animaNecessaria) {
    esiti.push(
      p.anima.diametro >= 4
        ? esito('ok', 'ANIMA_OBBLIGATORIA', {
            messaggio: `Perno d’acciaio ⌀ ${mm(p.anima.diametro)} presente.`,
            valore: p.anima.diametro,
            soglia: 4,
          })
        : esito('avviso', 'ANIMA_OBBLIGATORIA', {
            messaggio: `Oltre 60 mm il ${variante} vuole un perno d’acciaio di almeno 4 mm.`,
            valore: p.anima.diametro,
            soglia: 4,
          }),
    );
  }
  if (p.anima.diametro > 0) {
    const nelTappo = Math.min(p.tappo.lunghezza, p.tappo.larghezza) - p.anima.diametro;
    const nelCorpo = distanzaPerno(p, profiloTacco(p, variante));
    esiti.push(
      nelTappo >= 3 && nelCorpo >= 1.5
        ? esito('ok', 'PERNO_PARETE', {
            messaggio: `Attorno al perno: ${mm(nelTappo / 2)} nel tappo, almeno ${mm(nelCorpo)} nel corpo.`,
            valore: Math.min(nelTappo / 2, nelCorpo),
            soglia: 1.5,
          })
        : esito('blocco', 'PERNO_PARETE', {
            messaggio: `Parete attorno al perno sotto 1,5 mm (tappo ${mm(nelTappo / 2)}, corpo ${mm(nelCorpo)}).`,
            valore: Math.min(nelTappo / 2, nelCorpo),
            soglia: 1.5,
          }),
    );
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

/**
 * La famiglia tacco.
 * @public
 */
export const tacco: Famiglia<ParametriTacco> = {
  id: 'tacco',
  versione: versioneRicetta,
  varianti,
  partTypes: ['heel', 'top_lift'],
  schema: schemaDaParametri<ParametriTacco>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p, opzioni) => costruisciConEsiti(lib, p, opzioni).pezzi,
  costruisciConEsiti,
  verifiche,
  viste: {
    principale: 'fianco_esterno',
    facce: [
      f(
        'fianco_esterno',
        90,
        0,
        'outer side profile of the heel, the foot-side view of a product photo: toe to the right, top lift on the ground line (shows height, back curve, breast curve, seat slope)',
      ),
      f('fianco_interno', -90, 0, 'inner (arch) side profile, toe to the left'),
      f(
        'davanti',
        180,
        0,
        'front of the heel, the breast that looks toward the toe (shows width at the seat and at the top lift)',
      ),
      f('dietro', 0, 0, 'back of the heel (dorso) seen from behind the shoe, the classic heel-from-behind view'),
      f('sopra', 0, 90, 'the seat from above, toe up (rare)'),
      f('sotto', 180, -90, 'the top lift (tappo) seen from below, toe up'),
    ],
    nomi: {
      fronte: { faccia: 'davanti', azimuth: 0, elevation: 0 },
      tre_quarti: { faccia: 'fianco_esterno', azimuth: 35, elevation: 15 },
      lato: { faccia: 'fianco_esterno', azimuth: 0, elevation: 0 },
      alto: { faccia: 'sopra', azimuth: 0, elevation: 0 },
    },
  },
  silhouette: { assi: ['x', 'y', 'z'], simmetrie: ['yz'] },
  materialiAmmessi: ['abs', 'pa6', 'pa_gf30', 'pu', 'legno_faggio', 'alluminio', 'tpu', 'acciaio'],
  emettiMain: (p, ipotesi, opzioni) =>
    emettiMainFamiglia({ id: 'tacco', versione: versioneRicetta, variante: varianteDi(opzioni) }, p, ipotesi),
};
