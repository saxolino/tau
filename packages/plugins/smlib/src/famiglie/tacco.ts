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
import {
  interpolaMonotona,
  limita,
  normalizzaConParametri,
  predefinitiDaParametri,
  radianti,
  schemaDaParametri,
} from '#famiglie/parametri.js';
import { sogliaSformo } from '#famiglie/processi.js';
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

/**
 * Famiglia `tacco` (specifica §1.1): varianti stiletto, blocco, rocchetto, cono e kitten.
 *
 * Telaio locale: origine sul piano d'appoggio al centro del tappo; +Y verso la punta del piede (il fronte del
 * tacco guarda +Y, il dorso −Y); +X verso l'esterno del piede destro. La seduta (dove il tacco incontra la forma)
 * è inclinata di `seduta.inclinazione` attorno a X: scende verso la punta e ha il punto posteriore a
 * z = `tacco.altezza` (l'altezza del mestiere si misura lì).
 *
 * Scelte registrate (esiti T-D1-02):
 * - corpo = `loft` di 7 sezioni chiuse (≈ 5–20 ms); le bombature sono «a sezioni» perché `loft` con `rails` rifiuta le
 *   sezioni chiuse; il rocchetto non usa `sweep` con scala (≈ 400 ms): stesso loft.
 * - le facce del loft sono B-spline e `draft` le rifiuta: la cavità di svuotamento è un secondo loft di sezioni
 *   ridotte di `parete + profondità · tan(sformo)`, già sformato, poi tolto dal corpo con le colonne per perno e
 *   chiodi (coni sformati);
 * - le sezioni sono piane, quindi le facce del tappo e della seduta lo sono già: lo `split` del passo 5 non serve.
 */

type Lib = typeof Smlib;

export type VarianteTacco = 'stiletto' | 'blocco' | 'rocchetto' | 'cono' | 'kitten';
type FormaSeduta = 'ellisse' | 'rettangolo' | 'scudo';

export type ParametriTacco = {
  tacco: { altezza: number; spinta: number };
  seduta: { forma: FormaSeduta; lunghezza: number; larghezza: number; raggioAngoli: number; inclinazione: number };
  tappo: {
    forma: 'ellisse' | 'rettangolo' | 'come_seduta';
    lunghezza: number;
    larghezza: number;
    altezza: number;
    materiale: 'tpu' | 'pu';
  };
  vita: { quota: number; scala: number };
  dorso: { bombatura: number };
  fronte: { bombatura: number };
  anima: { diametro: number };
  fori: { numero: number; diametro: number };
  costruzione: {
    processo: 'stampaggio_iniezione' | 'cnc' | 'stampa_3d_resina';
    materiale: 'abs' | 'pa6' | 'pa_gf30' | 'pu' | 'legno_faggio' | 'alluminio';
    parete: number;
    sformo: number;
    lato: 'dx' | 'sx' | 'coppia';
  };
};

const varianti = ['stiletto', 'blocco', 'rocchetto', 'cono', 'kitten'] as const;
const variantiRigate: readonly VarianteTacco[] = ['blocco', 'cono'];

const svuotatoDi = (p: ParametriTacco): boolean =>
  p.costruzione.processo === 'stampaggio_iniezione' && p.seduta.lunghezza * p.seduta.larghezza > 900;
const lunghezzaAnima = (p: ParametriTacco): number => p.tacco.altezza - p.tappo.altezza - 8;

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
    descrizione: 'Altezza dal piano d’appoggio al punto posteriore della seduta',
  },
  {
    chiave: 'tacco.spinta',
    unita: 'deg',
    min: -2,
    max: 10,
    default: 3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Inclinazione in avanti dell’asse del tacco',
  },
  {
    chiave: 'seduta.forma',
    unita: 'enum',
    valori: ['ellisse', 'rettangolo', 'scudo'],
    default: 'ellisse',
    fonteDefault: 'mestiere',
    descrizione: 'Forma della seduta',
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
    descrizione: 'Lunghezza della seduta (verso la punta)',
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
    descrizione: 'Larghezza della seduta',
  },
  {
    chiave: 'seduta.raggioAngoli',
    unita: 'mm',
    min: 0,
    max: 30,
    default: 12,
    fonteDefault: 'scelta_nostra',
    descrizione: 'Raggio degli angoli (rettangolo, scudo)',
  },
  {
    chiave: 'seduta.inclinazione',
    unita: 'deg',
    min: 0,
    max: 15,
    default: 6,
    fonteDefault: 'mestiere',
    descrizione: 'Inclinazione della seduta (calzata media), scende verso la punta',
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
    descrizione: 'Quota della vita (0 tappo, 1 seduta)',
  },
  {
    chiave: 'vita.scala',
    unita: 'frazione',
    min: 0.25,
    max: 1.2,
    default: 0.45,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Larghezza della vita rispetto alla seduta',
  },
  {
    chiave: 'dorso.bombatura',
    unita: 'mm',
    min: -10,
    max: 15,
    default: 6,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Bombatura del dorso (verso −Y)',
  },
  {
    chiave: 'fronte.bombatura',
    unita: 'mm',
    min: -12,
    max: 10,
    default: -4,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Bombatura del fronte (verso +Y; negativa = concavo)',
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
    default: 72,
    fonteDefault: 'derivato',
    derivato: (p) => lunghezzaAnima(p as ParametriTacco),
    descrizione: 'Altezza − tappo − 8 mm',
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
    descrizione: 'Sformo della cavità',
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
    'seduta.forma': 'rettangolo',
    'tappo.forma': 'come_seduta',
    'tappo.lunghezza': 49,
    'tappo.larghezza': 42,
    'vita.scala': 1,
    'dorso.bombatura': 0,
    'fronte.bombatura': 0,
    'anima.diametro': 0,
    'fori.numero': 4,
  },
  rocchetto: {
    'tacco.altezza': 55,
    'tacco.spinta': 2,
    'tappo.lunghezza': 16,
    'tappo.larghezza': 16,
    'vita.quota': 0.5,
    'vita.scala': 0.5,
    'dorso.bombatura': 8,
    'fronte.bombatura': 6,
    'anima.diametro': 0,
  },
  cono: {
    'tacco.altezza': 45,
    'tacco.spinta': 2,
    'tappo.lunghezza': 20,
    'tappo.larghezza': 20,
    'vita.scala': 0.725,
    'dorso.bombatura': 0,
    'fronte.bombatura': 0,
    'anima.diametro': 0,
  },
  kitten: { 'tacco.altezza': 40, 'anima.diametro': 0 },
};

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteTacco =>
  varianti.includes(opzioni?.variante as VarianteTacco) ? (opzioni!.variante as VarianteTacco) : 'stiletto';

const predefiniti = (variante?: string): ParametriTacco =>
  predefinitiDaParametri<ParametriTacco>(parametri, sostituzioniVariante[varianteDi({ variante })]);

const spostamentoTappo = (p: ParametriTacco): number =>
  (p.tacco.altezza - p.tappo.altezza) * Math.tan(radianti(p.tacco.spinta));

const vincoli = (p: ParametriTacco): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
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
  if (vita.scala * seduta.larghezza < tappo.larghezza * 0.8) {
    violati.push({ chiave: 'vita.scala', messaggio: 'La vita è più stretta del tappo oltre il 20 %.' });
  }
  if (Math.abs(spostamentoTappo(p)) > seduta.lunghezza / 2) {
    violati.push({
      chiave: 'tacco.spinta',
      messaggio: 'Con questa spinta il tappo esce dalla proiezione della seduta.',
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
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(varianteDi(opzioni)));
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
  // (4) Vita non più stretta del tappo oltre il 20 %.
  vita.scala = limita(Math.max(vita.scala, (tappo.larghezza * 0.8) / seduta.larghezza), 0.25, 1.2);
  // (5) Spinta: il tappo resta sotto la seduta.
  const massima = (Math.atan(seduta.lunghezza / 2 / (tacco.altezza - tappo.altezza)) * 180) / Math.PI;
  tacco.spinta = limita(tacco.spinta, -massima, massima);
  // Materiale coerente col processo.
  const legno = costruzione.materiale === 'legno_faggio' || costruzione.materiale === 'alluminio';
  if (costruzione.processo === 'cnc' && !legno) {
    costruzione.materiale = 'legno_faggio';
  } else if (costruzione.processo !== 'cnc' && legno) {
    costruzione.materiale = 'abs';
  }
  return p;
};

/** Una sezione del tacco centrata su XY: x = larghezza, y = lunghezza (verso la punta). */
function sezione(lib: Lib, forma: FormaSeduta, larghezza: number, lunghezza: number, raggio: number): Smlib.Sketch {
  const r = Math.min(raggio, 0.49 * Math.min(larghezza, lunghezza / 2));
  if (forma === 'ellisse') {
    return lib.Ellipse(larghezza / 2, lunghezza / 2);
  }
  if (forma === 'rettangolo') {
    return lib.Rectangle(
      larghezza,
      lunghezza,
      r > 0.05 ? { fillet: Math.min(r, 0.49 * Math.min(larghezza, lunghezza)) } : {},
    );
  }
  // Scudo: petto dritto verso la punta, tallone tondo (Hull di un rettangolo e di un cerchio: solo rette e archi).
  const raggioTallone = Math.min(larghezza, lunghezza) / 2;
  const petto = lib.Rectangle(larghezza, lunghezza / 2).translate(0, lunghezza / 4);
  const scudo = lib.Hull(petto, lib.Pos(0, -lunghezza / 2 + raggioTallone).mul(lib.Circle(raggioTallone)));
  return r > 0.05
    ? scudo.fillet(r, [
        [-larghezza / 2, lunghezza / 2],
        [larghezza / 2, lunghezza / 2],
      ])
    : scudo;
}

/**
 * Se un punto sta dentro il contorno di una sezione ridotto di `riduzione` (approssimazione per difetto della
 * sezione offsettata: l'ellisse a semiassi ridotti sta dentro l'offset vero).
 */
function dentroSezione(
  forma: FormaSeduta,
  dimensioni: { larghezza: number; lunghezza: number; raggio: number; riduzione: number },
  punto: readonly [number, number],
): boolean {
  const a = dimensioni.larghezza / 2 - dimensioni.riduzione;
  const b = dimensioni.lunghezza / 2 - dimensioni.riduzione;
  if (a <= 0 || b <= 0) {
    return false;
  }
  const [x, y] = punto;
  const nellEllisse = (x / a) ** 2 + (y / b) ** 2 <= 1;
  if (forma === 'ellisse') {
    return nellEllisse;
  }
  const r = Math.max(
    0,
    Math.min(dimensioni.raggio, 0.49 * Math.min(dimensioni.larghezza, dimensioni.lunghezza / 2)) - dimensioni.riduzione,
  );
  const nelRettangolo =
    Math.abs(x) <= a &&
    Math.abs(y) <= b &&
    Math.max(Math.abs(x) - (a - r), 0) ** 2 + Math.max(Math.abs(y) - (b - r), 0) ** 2 <= r ** 2 + 1e-9;
  if (forma === 'rettangolo') {
    return nelRettangolo;
  }
  const raggioTallone = Math.min(dimensioni.larghezza, dimensioni.lunghezza) / 2 - dimensioni.riduzione;
  const centroTallone = -dimensioni.lunghezza / 2 + Math.min(dimensioni.larghezza, dimensioni.lunghezza) / 2;
  return y >= centroTallone
    ? Math.abs(x) <= a &&
        y <= b &&
        (y < b - r || Math.max(Math.abs(x) - (a - r), 0) ** 2 + (y - (b - r)) ** 2 <= r ** 2 + 1e-9)
    : Math.hypot(x, y - centroTallone) <= raggioTallone;
}

type Stazione = { larghezza: number; lunghezza: number; y: number; z: number; scala: number; inclinazione: number };

/** La legge delle sezioni lungo l'asse: t = 0 al tappo, t = 1 alla seduta (§1.1, passo 2). */
function stazione(p: ParametriTacco, variante: VarianteTacco, t: number): Stazione {
  const { tacco, seduta, tappo, vita } = p;
  const corpo = tacco.altezza - tappo.altezza;
  const z = tappo.altezza + t * corpo;
  const sx0 = tappo.larghezza / seduta.larghezza;
  const sy0 = tappo.lunghezza / seduta.lunghezza;
  const rigata = variantiRigate.includes(variante);
  const sx = rigata
    ? sx0 + (1 - sx0) * t
    : interpolaMonotona(
        [
          [0, sx0],
          [vita.quota, vita.scala],
          [1, 1],
        ],
        t,
      );
  const sy = rigata
    ? sy0 + (1 - sy0) * t
    : interpolaMonotona(
        [
          [0, sy0],
          [vita.quota, vita.scala],
          [1, 1],
        ],
        t,
      );
  const b = rigata ? 0 : Math.sin(Math.PI * t);
  const lunghezzaLegge = seduta.lunghezza * sy;
  return {
    larghezza: seduta.larghezza * sx,
    lunghezza: Math.max(0.3 * lunghezzaLegge, lunghezzaLegge + (p.fronte.bombatura + p.dorso.bombatura) * b),
    y: -(1 - t) * spostamentoTappo(p) + ((p.fronte.bombatura - p.dorso.bombatura) / 2) * b,
    z,
    scala: Math.min(sx, sy),
    // La seduta è inclinata e la sezione sotto lo è a metà (nei tacchi bassi le due non si toccano); le altre restano
    // orizzontali, così le pareti della cavità tengono lo sformo dato.
    inclinazione: t >= 1 - 1e-9 ? seduta.inclinazione : t >= 5 / 6 - 1e-9 ? seduta.inclinazione / 2 : 0,
  };
}

/** Le quote delle sezioni (t di 0…1): k/6, come nella ricetta della specifica. */
function quoteSezioni(): number[] {
  return [0, 1, 2, 3, 4, 5, 6].map((k) => k / 6);
}

/**
 * Posa uno schizzo centrato nella sua stazione: traslato al centro e ruotato attorno all'asse X che passa per il
 * punto posteriore della sezione, così il dorso resta alla quota della legge (e la seduta ha il punto posteriore
 * a z = altezza).
 */
const posa = (lib: Lib, schizzo: Smlib.Sketch, s: Stazione): Smlib.Sketch => {
  const posato = lib.Pos(0, s.y, s.z).mul(schizzo);
  return s.inclinazione === 0
    ? posato
    : posato.rotate(new lib.Axis([0, s.y - s.lunghezza / 2, s.z], [1, 0, 0]), -s.inclinazione);
};

/** Il punto dell'asse del perno alla quota z (dal tappo verso la seduta, inclinato della spinta). */
const assePerno = (p: ParametriTacco, z: number): { y: number; z: number } => ({
  y: -spostamentoTappo(p) + (z - p.tappo.altezza) * Math.tan(radianti(p.tacco.spinta)),
  z,
});

/** Posizioni (x, y) dei fori di fissaggio sulla seduta (§1.1, passo 9). */
function posizioniFori(lib: Lib, p: ParametriTacco): [number, number][] {
  const { numero } = p.fori;
  const { lunghezza, larghezza } = p.seduta;
  if (numero <= 0) {
    return [];
  }
  if (numero === 1) {
    return [[0, 0]];
  }
  if (numero === 2) {
    return [
      [0, lunghezza * 0.175],
      [0, -lunghezza * 0.175],
    ];
  }
  const posizioni =
    numero === 3
      ? lib.PolarLocations(larghezza * 0.25, 3, { startAngle: 90 })
      : lib.GridLocations(larghezza * 0.3, lunghezza * 0.35, 2, 2);
  return posizioni.points.map((punto) => [punto.x, punto.y]);
}

type CorpoTacco = {
  corpo: Smlib.Part;
  cavita: (readonly [number, number, number])[];
  anima?: Smlib.Part;
  foroAnima?: Smlib.Part;
};

type Colonna = { x: number; y: (z: number) => number; raggio: number; sformo: number };

/**
 * La cavità di svuotamento dal lato seduta, in un solo loft: sezioni ridotte di `parete + profondità · tan(sformo)`
 * (già sformate verso la seduta) alle quote delle sezioni del corpo, chiuse da una sezione 1,5 mm sopra la seduta;
 * le colonne del perno e dei chiodi sono fori delle sezioni, più larghi in basso (sformate anch'esse). Il fondo
 * scende finché nucleo e colonne ci stanno e le sezioni non si allargano scendendo. I chiodi si avvicinano al centro
 * finché la loro colonna sta dentro la cavità senza toccare quella del perno; se non ci stanno restano fuori.
 */
function costruisciCavita(
  lib: Lib,
  p: ParametriTacco,
  variante: VarianteTacco,
  fori: readonly [number, number][],
  esiti: Esito[],
): { cavita?: Smlib.Part; fori: [number, number][] } {
  const { costruzione, seduta, tacco, anima } = p;
  const tanSformo = Math.tan(radianti(costruzione.sformo));
  const riduzione = (z: number): number => costruzione.parete + (tacco.altezza - z) * tanSformo;
  const margine = 0.8;
  const cerchio = (colonna: Colonna, s: Stazione): { x: number; y: number; r: number } => ({
    x: colonna.x,
    y: colonna.y(s.z) - s.y,
    r: colonna.raggio + (tacco.altezza - s.z) * Math.tan(radianti(colonna.sformo)),
  });
  const ciStanno = (s: Stazione, elenco: readonly Colonna[]): boolean => {
    const dimensioni = {
      larghezza: s.larghezza,
      lunghezza: s.lunghezza,
      raggio: s.scala * seduta.raggioAngoli,
      riduzione: riduzione(s.z),
    };
    if (Math.min(s.larghezza, s.lunghezza) - 2 * dimensioni.riduzione < 6) {
      return false;
    }
    const cerchi = elenco.map((colonna) => cerchio(colonna, s));
    const separati = cerchi.every((a, i) =>
      cerchi.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 1.5),
    );
    return (
      separati &&
      cerchi.every(({ x, y, r }) =>
        Array.from({ length: 16 }, (_, k) => (k * Math.PI) / 8).every((angolo) =>
          dentroSezione(seduta.forma, dimensioni, [
            x + (r + margine) * Math.cos(angolo),
            y + (r + margine) * Math.sin(angolo),
          ]),
        ),
      )
    );
  };
  // Scendendo le sezioni non si allargano (in pianta), altrimenti la parete interna andrebbe in sottosquadro.
  const annidata = (sotto: Stazione, sopra: Stazione): boolean =>
    sotto.larghezza <= sopra.larghezza + 1e-6 &&
    sotto.y - sotto.lunghezza / 2 >= sopra.y - sopra.lunghezza / 2 - 1e-6 &&
    sotto.y + sotto.lunghezza / 2 <= sopra.y + sopra.lunghezza / 2 + 1e-6;
  const colonne: Colonna[] =
    anima.diametro > 0
      ? [
          {
            x: 0,
            y: (z) => assePerno(p, z).y,
            raggio: anima.diametro / 2 + 0.1 + costruzione.parete,
            sformo: costruzione.sformo + Math.abs(tacco.spinta) + 0.5,
          },
        ]
      : [];
  const griglia = quoteSezioni();
  const alta = stazione(p, variante, griglia[5]!);
  const seduta1 = stazione(p, variante, 1);
  const colonnaChiodo = (x: number, y: number): Colonna => ({
    x,
    y: () => y,
    raggio: p.fori.diametro / 2 + costruzione.parete,
    sformo: costruzione.sformo + 0.5,
  });
  // I chiodi: le posizioni della ricetta, poi più vicine al centro (a passi del 10 %); con il perno, anche in giro
  // attorno alla sua colonna (un chiodo dietro e due davanti, o il contrario), finché le colonne ci stanno.
  const candidati: { posizioni: [number, number][]; nota?: string }[] = [];
  for (let fattore = 1; fattore >= 0.45; fattore -= 0.1) {
    candidati.push({
      posizioni: fori.map(([x, y]) => [x * fattore, y * fattore]),
      ...(fattore < 1 ? { nota: `avvicinati al centro (${Math.round(fattore * 100)} %)` } : {}),
    });
  }
  if (anima.diametro > 0 && fori.length >= 2) {
    // Con il perno: i chiodi in giro attorno alla sua colonna, dietro (dove il dorso è più largo) o davanti.
    const centro = assePerno(p, tacco.altezza).y;
    const separazione = colonne[0]!.raggio + p.fori.diametro / 2 + costruzione.parete + 2.5;
    const chiodi = fori.length;
    for (const inizio of [-90, 90]) {
      for (let raggio = seduta.larghezza * 0.25; raggio >= separazione - 1e-9; raggio -= 1) {
        candidati.push({
          posizioni: Array.from({ length: chiodi }, (_, k) => {
            const angolo = radianti(inizio + (360 * k) / chiodi);
            return [raggio * Math.cos(angolo), centro + raggio * Math.sin(angolo)];
          }),
          nota: `attorno al perno a ${mm(raggio, 1)}`,
        });
      }
    }
    // Ultima scelta: la vite centrale entra nella colonna del perno, sopra la sua testa; i chiodi restano fuori.
    candidati.push({ posizioni: [], nota: 'ridotti alla vite centrale nella colonna del perno' });
  }
  let foriTenuti: [number, number][] = [];
  for (const { posizioni, nota } of fori.length > 0 ? candidati : []) {
    const elenco = [...colonne, ...posizioni.map(([x, y]) => colonnaChiodo(x, y))];
    if (ciStanno(alta, elenco) && ciStanno(seduta1, elenco)) {
      foriTenuti = posizioni.length > 0 ? posizioni : [[0, assePerno(p, tacco.altezza).y]];
      if (nota) {
        esiti.push(
          esito('info', 'FORI_SPOSTATI', `Fori di fissaggio ${nota}: così le colonne stanno nella cavità.`, {
            pezzo: 'Tacco',
          }),
        );
      }
      break;
    }
  }
  if (fori.length > 0 && foriTenuti.length === 0) {
    esiti.push(
      esito('avviso', 'FORO_FUORI', 'Le colonne dei fori non stanno nella cavità: fori tolti, fissaggio da definire.', {
        pezzo: 'Tacco',
      }),
    );
  }
  const vitePerno =
    anima.diametro > 0 &&
    foriTenuti.length === 1 &&
    Math.abs(foriTenuti[0]![0]) < 1e-9 &&
    Math.abs(foriTenuti[0]![1] - assePerno(p, tacco.altezza).y) < 1e-9;
  colonne.push(...(vitePerno ? [] : foriTenuti.map(([x, y]) => colonnaChiodo(x, y))));
  if (!ciStanno(alta, colonne) || !annidata(alta, seduta1)) {
    esiti.push(esito('info', 'SVUOTAMENTO', 'Seduta troppo stretta per la cavità: tacco pieno.', { pezzo: 'Tacco' }));
    return { fori: [...fori] };
  }
  // Il fondo sta su una quota delle sezioni del corpo: interno ed esterno si interpolano sulle stesse stazioni.
  const minimo = Math.max(p.vita.quota, 0.35);
  let fondo = 5;
  while (fondo > 1 && griglia[fondo - 1]! >= minimo - 1e-9) {
    const sotto = stazione(p, variante, griglia[fondo - 1]!);
    if (!ciStanno(sotto, colonne) || !annidata(sotto, stazione(p, variante, griglia[fondo]!))) {
      break;
    }
    fondo -= 1;
  }
  const ridotta = (s: Stazione, profondita: number): Smlib.Sketch => {
    let schizzo = sezione(lib, seduta.forma, s.larghezza, s.lunghezza, s.scala * seduta.raggioAngoli).offset(
      -(costruzione.parete + profondita * tanSformo),
      { corners: 'round' },
    );
    for (const colonna of colonne) {
      const { x, y, r } = cerchio(colonna, { ...s, z: tacco.altezza - profondita });
      schizzo = schizzo.cut(lib.Pos(x, y).mul(lib.Circle(r)));
    }
    return posa(lib, schizzo, s);
  };
  const sezioni = griglia.slice(fondo, 6).map((t) => {
    const s = stazione(p, variante, t);
    return ridotta(s, tacco.altezza - s.z);
  });
  const normale = new lib.Vector(0, Math.sin(radianti(seduta.inclinazione)), Math.cos(radianti(seduta.inclinazione)));
  const cima = ridotta(seduta1, 0).translate(normale.mul(1.5));
  return { cavita: lib.loft([...sezioni, cima], { smooth: sezioni.length + 1 >= 4 }), fori: foriTenuti };
}

/** Corpo del tacco destro con cavità, fori e sede del perno. */
function costruisciCorpo(lib: Lib, p: ParametriTacco, variante: VarianteTacco, esiti: Esito[]): CorpoTacco {
  const { seduta, tappo, tacco, anima } = p;
  const formaTappo: FormaSeduta = tappo.forma === 'come_seduta' ? seduta.forma : tappo.forma;
  const griglia = quoteSezioni();
  const indici = variantiRigate.includes(variante) ? [0, 6] : [0, 1, 2, 3, 4, 5, 6];
  const sezioni = indici.map((k) => {
    const s = stazione(p, variante, griglia[k]!);
    const schizzo =
      k === 0
        ? sezione(lib, formaTappo, tappo.larghezza, tappo.lunghezza, seduta.raggioAngoli * s.scala)
        : sezione(lib, seduta.forma, s.larghezza, s.lunghezza, seduta.raggioAngoli * s.scala);
    return posa(lib, schizzo, s);
  });
  let corpo = lib.loft(sezioni, variantiRigate.includes(variante) ? { ruled: true } : { smooth: true });
  // Raccordo del bordo verso il tappo (spigolo del loft, non di una booleana); nessuno sul bordo della seduta.
  try {
    corpo = corpo.fillet(corpo.edges().bottom(), Math.min(0.6, 0.2 * Math.min(tappo.larghezza, tappo.lunghezza)));
  } catch {
    esiti.push(
      esito('avviso', 'RACCORDO_RIDOTTO', 'Raccordo del bordo verso il tappo non costruibile: spigolo vivo.', {
        pezzo: 'Tacco',
      }),
    );
  }
  let fori = posizioniFori(lib, p);
  let cavita: Smlib.Part | undefined;
  if (svuotatoDi(p)) {
    try {
      const risultato = costruisciCavita(lib, p, variante, fori, esiti);
      cavita = risultato.cavita;
      fori = risultato.fori;
    } catch (error) {
      esiti.push(
        esito('avviso', 'SVUOTAMENTO', `Cavità non costruita (${(error as Error).message}): tacco pieno.`, {
          pezzo: 'Tacco',
        }),
      );
    }
  }
  const strumenti: Smlib.Part[] = cavita ? [cavita] : [];
  const pendenza = Math.tan(radianti(seduta.inclinazione));
  for (const [x, y] of fori) {
    // Sull'asse del perno la vite si ferma 1 mm sopra la sua testa.
    const sulPerno = anima.diametro > 0 && Math.hypot(x, y - assePerno(p, tacco.altezza).y) < anima.diametro / 2 + 0.1;
    const testaPerno = tappo.altezza - 2 + lunghezzaAnima(p) * Math.cos(radianti(tacco.spinta));
    const utile = sulPerno ? Math.max(3, Math.min(14, tacco.altezza - testaPerno - 1)) : 14;
    const profondita = utile + (y + seduta.lunghezza / 2) * pendenza + 2;
    strumenti.push(
      lib
        .Pos(x, y, tacco.altezza + 2)
        .mul(
          lib.Cylinder(p.fori.diametro / 2, profondita, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX] }),
        ),
    );
  }
  let pernoPezzo: Smlib.Part | undefined;
  let foroAnima: Smlib.Part | undefined;
  if (anima.diametro > 0) {
    const base = assePerno(p, tappo.altezza - 2);
    const lungo = lunghezzaAnima(p);
    const lungoAsse = (raggio: number, lunghezza: number): Smlib.Part =>
      lib
        .Pos(0, base.y, base.z)
        .mul(
          lib
            .Rot(-tacco.spinta, 0, 0)
            .mul(lib.Cylinder(raggio, lunghezza, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] })),
        );
    pernoPezzo = lungoAsse(anima.diametro / 2, lungo);
    foroAnima = lungoAsse(anima.diametro / 2 + 0.1, lungo + 0.1);
    strumenti.push(foroAnima);
  }
  if (strumenti.length > 0) {
    corpo = corpo.cut(...strumenti);
  }
  const cavitaPunti = cavita ? puntiDiFacce(corpo.faces().derivedFrom(cavita)) : [];
  if (!corpo.isValid()) {
    esiti.push(esito('blocco', 'SOLIDO_NON_VALIDO', 'Il corpo del tacco non è un solido valido.', { pezzo: 'Tacco' }));
  }
  return {
    corpo: normalizzaForma(lib, corpo),
    cavita: cavitaPunti,
    ...(pernoPezzo ? { anima: pernoPezzo } : {}),
    ...(foroAnima ? { foroAnima } : {}),
  };
}

function costruisciTappo(lib: Lib, p: ParametriTacco, foroAnima: Smlib.Part | undefined): Smlib.Part {
  const { tappo, seduta } = p;
  const forma: FormaSeduta = tappo.forma === 'come_seduta' ? seduta.forma : tappo.forma;
  const scala = Math.min(tappo.larghezza / seduta.larghezza, tappo.lunghezza / seduta.lunghezza);
  let pezzo = lib
    .Pos(0, -spostamentoTappo(p), 0)
    .mul(sezione(lib, forma, tappo.larghezza, tappo.lunghezza, seduta.raggioAngoli * scala))
    .extrude(tappo.altezza);
  try {
    pezzo = pezzo.fillet(
      pezzo.edges().bottom(),
      Math.min(0.8, 0.45 * tappo.altezza, 0.2 * Math.min(tappo.larghezza, tappo.lunghezza)),
    );
  } catch {
    // Spigolo vivo: il sopratacco si rifila comunque in finitura.
  }
  return normalizzaForma(lib, foroAnima ? pezzo.cut(foroAnima) : pezzo);
}

function costruisciConEsiti(lib: Lib, p: ParametriTacco, opzioni?: OpzioniFamiglia): RisultatoCostruzione {
  const variante = varianteDi(opzioni);
  const esiti: Esito[] = [];
  const destri: PezzoFamiglia[] = [];
  try {
    const { corpo, cavita, anima, foroAnima } = costruisciCorpo(lib, p, variante, esiti);
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
      shape: costruisciTappo(lib, p, foroAnima),
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
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Tacco non costruito: ${(error as Error).message}`, { pezzo: 'Tacco' }),
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

/** Distanza minima del perno dalla superficie esterna, sezione per sezione (ellisse equivalente). */
function distanzaPerno(p: ParametriTacco, variante: VarianteTacco): number {
  let minima = Number.POSITIVE_INFINITY;
  const fine = (lunghezzaAnima(p) * Math.cos(radianti(p.tacco.spinta)) - 2) / (p.tacco.altezza - p.tappo.altezza);
  for (let k = 0; k <= 24; k++) {
    const t = (k / 24) * limita(fine, 0, 1);
    const s = stazione(p, variante, t);
    const asse = assePerno(p, s.z);
    const scarto = Math.abs(asse.y - s.y);
    const semiLunghezza = s.lunghezza / 2;
    const semiLarghezza = s.larghezza / 2;
    const lato = scarto < semiLunghezza ? semiLarghezza * Math.sqrt(1 - (scarto / semiLunghezza) ** 2) : 0;
    minima = Math.min(minima, Math.min(lato, semiLunghezza - scarto) - p.anima.diametro / 2);
  }
  return minima;
}

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
      esitoMinimo(
        'PARETE_MIN',
        parete.min,
        sogliaPareteTacco(processo, p.costruzione.materiale),
        'Parete della cavità',
        {
          pezzo: corpo.name,
        },
      ),
    );
    const minimoSformo = sogliaSformo(processo, p.costruzione.materiale);
    if (minimoSformo !== undefined) {
      esiti.push(
        ...esitiSformo(
          sformo(corpo.shape, [0, 0, 1], minimoSformo - 1e-3, facce),
          minimoSformo,
          corpo.name,
          'Cavità (estrazione verso la seduta)',
        ),
      );
    }
  } else {
    esiti.push(
      esito(
        'info',
        'PARETE_MIN',
        'Tacco pieno: nessuna parete di svuotamento da misurare.',
        corpo ? { pezzo: corpo.name } : {},
      ),
    );
  }
  if ((variante === 'stiletto' || variante === 'kitten') && Math.min(p.tappo.lunghezza, p.tappo.larghezza) < 8) {
    esiti.push(
      esito(
        'avviso',
        'TAPPO_MIN',
        `Tappo di ${mm(Math.min(p.tappo.lunghezza, p.tappo.larghezza))}: sotto 8 mm consuma presto.`,
        { soglia: 8 },
      ),
    );
  }
  const animaNecessaria =
    p.tacco.altezza > 60 && (variante === 'stiletto' || variante === 'kitten' || variante === 'rocchetto');
  if (animaNecessaria) {
    esiti.push(
      p.anima.diametro >= 4
        ? esito('ok', 'ANIMA_OBBLIGATORIA', `Perno d’acciaio ⌀ ${mm(p.anima.diametro)} presente.`, {
            valore: p.anima.diametro,
            soglia: 4,
          })
        : esito('avviso', 'ANIMA_OBBLIGATORIA', `Oltre 60 mm il ${variante} vuole un perno d’acciaio di almeno 4 mm.`, {
            valore: p.anima.diametro,
            soglia: 4,
          }),
    );
  }
  if (p.anima.diametro > 0) {
    const nelTappo = Math.min(p.tappo.lunghezza, p.tappo.larghezza) - p.anima.diametro;
    const nelCorpo = distanzaPerno(p, variante);
    esiti.push(
      nelTappo >= 3 && nelCorpo >= 1.5
        ? esito(
            'ok',
            'PERNO_PARETE',
            `Attorno al perno: ${mm(nelTappo / 2)} nel tappo, almeno ${mm(nelCorpo)} nel corpo.`,
            { valore: Math.min(nelTappo / 2, nelCorpo), soglia: 1.5 },
          )
        : esito(
            'blocco',
            'PERNO_PARETE',
            `Parete attorno al perno sotto 1,5 mm (tappo ${mm(nelTappo / 2)}, corpo ${mm(nelCorpo)}).`,
            { valore: Math.min(nelTappo / 2, nelCorpo), soglia: 1.5 },
          ),
    );
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

export const tacco: Famiglia<ParametriTacco> = {
  id: 'tacco',
  versione: 1,
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
  silhouette: { assi: ['x', 'y', 'z'], simmetrie: ['yz'] },
  materialiAmmessi: ['abs', 'pa6', 'pa_gf30', 'pu', 'legno_faggio', 'alluminio', 'tpu', 'acciaio'],
  emettiMain: (p, ipotesi, opzioni) => emettiMainFamiglia('tacco', 1, varianteDi(opzioni), p, ipotesi),
};
