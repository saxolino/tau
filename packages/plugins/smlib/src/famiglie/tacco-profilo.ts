import { limita, radianti } from '#famiglie/parametri.js';

/**
 * La forma del tacco come la disegna il modellista, in numeri puri (nessun kernel): il profilo di fianco (dorso e
 * petto), la larghezza vista da dietro, la pianta di ogni sezione orizzontale e la seduta, inclinata e concava sotto la
 * scarpa. `tacco.ts` ne fa il solido con SMLib; i test la controllano senza costruire nulla.
 *
 * Telaio: origine sul piano d'appoggio; +Y verso la punta del piede (petto), −Y il dorso; +X verso l'esterno del piede
 * destro; Z in alto. La seduta, vista in pianta, è centrata su y = 0: il punto posteriore B sta a quota `tacco.altezza`
 * (l'altezza del mestiere si misura lì), il punto anteriore F più in basso dell'inclinazione della seduta.
 *
 * Perché così (la versione 1 faceva una «tromba»): le sezioni erano ellissi centrate su un asse e scalate uguali
 * davanti e dietro, quindi dorso e petto si allargavano simmetrici verso una seduta piana; un tacco vero si disegna
 * invece con due linee indipendenti di fianco — il dorso, lungo e quasi dritto, e il petto, che sale dal fusto e si apre
 * ad arco sotto la parte anteriore della seduta — più la larghezza vista da dietro. Qui:
 * - fusto (stiletto, kitten): dal tappo alla vita le linee sono dritte; sopra la vita si aprono verso la seduta con
 *   tangente continua (curva `u^e`: l'apertura cresce verso l'alto), più la bombatura come correzione;
 * - rocchetto: la vita è il punto più stretto e da lì le linee si aprono sia verso la seduta sia verso il tappo;
 * - blocco e cono: linee dritte dal tappo alla seduta, più la bombatura ad arco;
 * - sopra la seduta le linee proseguono sulla loro tangente (scorta che la seduta poi taglia): niente spigoli nel loft;
 * - la seduta è il piano per B e F, scavato al centro (la forma della scarpa è convessa, la seduta concava).
 */

/**
 * Varianti della famiglia tacco.
 * @public
 */
export type VarianteTacco = 'stiletto' | 'blocco' | 'rocchetto' | 'cono' | 'kitten';

/**
 * Forma in pianta della seduta (o del tappo).
 * @public
 */
export type FormaSeduta = 'ellisse' | 'rettangolo' | 'scudo';

/**
 * Parametri della famiglia tacco, annidati per pezzo.
 * @public
 */
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

/** Le varianti con il fusto: dritto sotto la vita (stiletto, kitten) o strozzato alla vita (rocchetto). */
const variantiConFusto: ReadonlySet<VarianteTacco> = new Set<VarianteTacco>(['stiletto', 'kitten', 'rocchetto']);

/**
 * Se la variante ha un fusto con la vita (stiletto, kitten, rocchetto); blocco e cono vanno dritti dal tappo alla seduta.
 * @param variante - La variante.
 * @returns True se la vita conta.
 * @public
 */
export const haFusto = (variante: VarianteTacco): boolean => variantiConFusto.has(variante);

/**
 * Quanto la vita può essere più stretta del tappo, in frazione della sua larghezza: il rocchetto si riapre verso terra,
 * gli altri no (la vita non è più stretta del tappo oltre il 20 %).
 * @param variante - La variante.
 * @returns La frazione.
 * @public
 */
export const strettezzaVita = (variante: VarianteTacco): number => (variante === 'rocchetto' ? 0.45 : 0.8);

/**
 * Una sezione orizzontale del tacco: la pianta a quota `z`, da `dorso` (y minimo) a `petto` (y massimo), larga
 * `larghezza`. Il contorno è una superellisse a due metà: verso il dorso con `esponenteDorso`, verso il petto con
 * `esponentePetto` (2 = ellisse, 4–8 = angoli via via più vivi), più larga a `largo` (frazione della lunghezza dal dorso).
 * @public
 */
export type SezioneTacco = Readonly<{
  z: number;
  dorso: number;
  petto: number;
  larghezza: number;
  esponenteDorso: number;
  esponentePetto: number;
  largo: number;
}>;

/** La seduta: punti di fianco, inclinazione e incavo (quanto scende sotto il piano per B e F). */
export type SedutaTacco = Readonly<{
  /** Punto posteriore B: [y, z]. */
  dorso: readonly [number, number];
  /** Punto anteriore F: [y, z]. */
  petto: readonly [number, number];
  /** Inclinazione in radianti (scende verso la punta). */
  inclinazione: number;
  /** Incavo longitudinale (al centro della lunghezza) e trasversale (al centro della larghezza), mm. */
  incavoLungo: number;
  incavoLargo: number;
}>;

/** La forma completa: sezioni del loft, tappo, seduta, asse del perno e linee di fianco campionate. @public */
export type ProfiloTacco = Readonly<{
  /** Dal tappo (z = altezza del tappo) fin sopra la seduta, in ordine di quota. */
  sezioni: readonly SezioneTacco[];
  /** La pianta del tappo (stessa della prima sezione). */
  tappo: SezioneTacco;
  seduta: SedutaTacco;
  /** Quota della vita (dove il fusto finisce), se la variante ne ha una. */
  vita?: number;
  /** Quota sopra cui le sezioni sono solo scorta per il taglio della seduta. */
  tetto: number;
  /** Il centro del tappo [y, z] e la direzione dell'asse del perno [dy, dz] (unitaria, inclinata della spinta). */
  asse: Readonly<{ base: readonly [number, number]; direzione: readonly [number, number] }>;
  /** La sezione alla quota z (interpolata dalle leggi, non dalle stazioni del loft). */
  sezioneA: (z: number) => SezioneTacco;
}>;

/** Esponente massimo della superellisse: oltre, la spline chiusa del contorno ondeggia sugli angoli. */
const esponenteMassimo = 8;

/**
 * L'esponente della superellisse che ha, sull'angolo, lo stesso scostamento dal rettangolo di un raccordo di raggio r.
 * @param raggio - Raggio d'angolo voluto.
 * @param semiasse - Il semiasse minore del quadrante.
 * @returns L'esponente (2 = ellisse quando il raggio arriva al semiasse).
 */
export function esponenteDaRaggio(raggio: number, semiasse: number): number {
  if (semiasse <= 0 || raggio >= semiasse) {
    return 2;
  }
  const frazione = (Math.max(raggio, 0) * (1 - Math.SQRT1_2)) / semiasse;
  if (frazione <= 1e-6) {
    return esponenteMassimo;
  }
  return limita(-Math.LN2 / Math.log(1 - frazione), 2, esponenteMassimo);
}

type FormaPianta = { esponenteDorso: number; esponentePetto: number; largo: number };

/**
 * La pianta per una forma: lo scudo ha il dorso tondo (segue il tallone della scarpa) e il petto dritto; il rettangolo
 * della seduta arrotonda comunque il dorso quanto basta per stare sotto il tallone.
 */
function formaPianta(
  forma: FormaSeduta,
  misure: { larghezza: number; lunghezza: number; raggio: number; seduta: boolean },
): FormaPianta {
  const { larghezza, lunghezza, raggio, seduta } = misure;
  const mezza = larghezza / 2;
  if (forma === 'ellisse') {
    return { esponenteDorso: 2, esponentePetto: 2, largo: 0.5 };
  }
  if (forma === 'rettangolo') {
    const semiasse = Math.min(mezza, lunghezza / 2);
    return {
      esponenteDorso: esponenteDaRaggio(seduta ? Math.max(raggio, 0.3 * larghezza) : raggio, semiasse),
      esponentePetto: esponenteDaRaggio(raggio, semiasse),
      largo: 0.5,
    };
  }
  const largo = limita(mezza / Math.max(lunghezza, 1e-6), 0.3, 0.6);
  return {
    esponenteDorso: 2,
    esponentePetto: esponenteDaRaggio(raggio, Math.min(mezza, (1 - largo) * lunghezza)),
    largo,
  };
}

/**
 * Il contorno di una sezione: `punti` punti in senso antiorario visto dall'alto, il primo sul dorso (x = 0), gli stessi
 * angoli parametrici per ogni sezione, così il loft non si attorciglia.
 * @param sezione - La sezione.
 * @param punti - Quanti punti (multiplo di 4).
 * @returns Coppie [x, y].
 * @public
 */
export function contornoSezione(sezione: SezioneTacco, punti = 32): Array<[number, number]> {
  const lunghezza = sezione.petto - sezione.dorso;
  const centro = sezione.dorso + sezione.largo * lunghezza;
  const indietro = sezione.largo * lunghezza;
  const avanti = (1 - sezione.largo) * lunghezza;
  const mezza = sezione.larghezza / 2;
  // Seno e coseno a 0 esatto ai quattro punti cardinali: 6e-17 alla potenza 2/8 varrebbe ancora un decimo di micron.
  const potenza = (valore: number, esponente: number): number =>
    Math.abs(valore) < 1e-12 ? 0 : Math.sign(valore) * Math.abs(valore) ** (2 / esponente);
  const contorno: Array<[number, number]> = [];
  for (let k = 0; k < punti; k++) {
    const t = (2 * Math.PI * k) / punti;
    const coseno = Math.cos(t);
    const verso = coseno >= 0 ? 'dorso' : 'petto';
    const esponente = verso === 'dorso' ? sezione.esponenteDorso : sezione.esponentePetto;
    const semiasse = verso === 'dorso' ? indietro : avanti;
    contorno.push([mezza * potenza(Math.sin(t), esponente), centro - semiasse * potenza(coseno, esponente)]);
  }
  return contorno;
}

/**
 * Mezza larghezza di una sezione alla coordinata y (0 fuori dalla sezione).
 * @param sezione - La sezione.
 * @param y - La coordinata lungo il tacco.
 * @returns La mezza larghezza.
 * @public
 */
export function mezzaLarghezzaA(sezione: SezioneTacco, y: number): number {
  const lunghezza = sezione.petto - sezione.dorso;
  if (y <= sezione.dorso || y >= sezione.petto || lunghezza <= 0) {
    return 0;
  }
  const centro = sezione.dorso + sezione.largo * lunghezza;
  const dietro = y < centro;
  const semiasse = dietro ? sezione.largo * lunghezza : (1 - sezione.largo) * lunghezza;
  const esponente = dietro ? sezione.esponenteDorso : sezione.esponentePetto;
  const relativo = Math.min(1, Math.abs(y - centro) / Math.max(semiasse, 1e-9));
  return (sezione.larghezza / 2) * (1 - relativo ** esponente) ** (1 / esponente);
}

/**
 * Se un punto (x, y) sta dentro una sezione.
 * @param sezione - La sezione.
 * @param punto - Il punto.
 * @returns True se dentro (bordo compreso).
 * @public
 */
export const dentroSezione = (sezione: SezioneTacco, punto: readonly [number, number]): boolean =>
  Math.abs(punto[0]) <= mezzaLarghezzaA(sezione, punto[1]) + 1e-9;

/** La legge di una linea di fianco su [z0, z1]: valore agli estremi, pendenza iniziale, esponente e bombatura. */
type Tratto = Readonly<{
  z0: number;
  z1: number;
  v0: number;
  v1: number;
  /** Pendenza dv/dz all'inizio (continuità con il tratto sotto). */
  pendenza0: number;
  esponente: number;
  /** Scostamento massimo dalla curva di base (a 2/3 del tratto), con il segno del verso. */
  bombatura: number;
  /**
   * Negli ultimi mm il tratto si raddrizza fino alla verticale (pendenza nulla in cima): il dorso arriva così sul punto
   * B della seduta, e sopra la scorta sale dritta senza spigolo nel loft e senza sporgere dietro B.
   */
  cimaVerticale?: number;
}>;

/** La pendenza dv/dz della curva di base di un tratto in cima. */
function pendenzaBase(tratto: Tratto): number {
  const altezza = tratto.z1 - tratto.z0;
  const lineare = tratto.pendenza0 * altezza;
  return (lineare + tratto.esponente * (tratto.v1 - tratto.v0 - lineare) - (27 / 4) * tratto.bombatura) / altezza;
}

/** Il valore di un tratto alla quota z (z dentro il tratto). */
function valoreTratto(tratto: Tratto, z: number): number {
  const altezza = tratto.z1 - tratto.z0;
  const u = limita((z - tratto.z0) / altezza, 0, 1);
  const lineare = tratto.pendenza0 * altezza;
  const base =
    tratto.v0 +
    lineare * u +
    (tratto.v1 - tratto.v0 - lineare) * u ** tratto.esponente +
    tratto.bombatura * (27 / 4) * u * u * (1 - u);
  const ultimi = tratto.cimaVerticale ?? 0;
  if (ultimi <= 0 || z <= tratto.z1 - ultimi) {
    return base;
  }
  // Correzione m·δ·g(t), g(t) = t(1 − t)², t = (z1 − z)/δ: nulla con la derivata a t = 1, annulla la pendenza in cima.
  const t = (tratto.z1 - z) / ultimi;
  return base + pendenzaBase(tratto) * ultimi * t * (1 - t) ** 2;
}

/** La pendenza dv/dz di un tratto in cima (per proseguire sulla tangente sopra la seduta). */
function pendenzaFinale(tratto: Tratto): number {
  return tratto.cimaVerticale ? 0 : pendenzaBase(tratto);
}

/** Una linea di fianco: tratti in ordine di quota, poi la tangente in cima, saturata a `oltre` mm. */
type Linea = Readonly<{ tratti: readonly Tratto[]; oltre: number }>;

function valoreLinea(linea: Linea, z: number): number {
  const primo = linea.tratti[0]!;
  if (z <= primo.z0) {
    return primo.v0;
  }
  for (const tratto of linea.tratti) {
    if (z <= tratto.z1) {
      return valoreTratto(tratto, z);
    }
  }
  const ultimo = linea.tratti.at(-1)!;
  const pendenza = pendenzaFinale(ultimo);
  const sopra = z - ultimo.z1;
  // Prosegue sulla tangente (niente spigolo nel loft) e si ferma entro `oltre`: è solo scorta da tagliare.
  return linea.oltre <= 0 ? ultimo.v1 : ultimo.v1 + linea.oltre * Math.tanh((pendenza * sopra) / linea.oltre);
}

/** La pendenza dv/dz del tratto dritto da (z0, v0) a (z1, v1). */
const pendenzaRetta = ([z0, v0]: readonly [number, number], [z1, v1]: readonly [number, number]): number =>
  (v1 - v0) / (z1 - z0);

/**
 * `quante` quote da `da` ad `a` (estremi compresi) a passi uguali della densità cumulata: dove la densità è doppia, le
 * sezioni sono fitte il doppio.
 * @param intervallo - Prima e ultima quota.
 * @param quante - Quante quote.
 * @param densita - Densità relativa per quota (positiva).
 * @returns Le quote in ordine.
 */
function distribuisci([da, a]: readonly [number, number], quante: number, densita: (z: number) => number): number[] {
  const passi = 400;
  const cumulata = [0];
  for (let k = 1; k <= passi; k++) {
    const z = da + ((a - da) * (k - 0.5)) / passi;
    cumulata.push(cumulata[k - 1]! + densita(z));
  }
  const totale = cumulata[passi]!;
  return Array.from({ length: quante }, (_, i) => {
    const obiettivo = (totale * i) / (quante - 1);
    let k = 1;
    while (k < passi && cumulata[k]! < obiettivo) {
      k++;
    }
    const frazione = (obiettivo - cumulata[k - 1]!) / Math.max(cumulata[k]! - cumulata[k - 1]!, 1e-12);
    return i === quante - 1 ? a : da + ((a - da) * (k - 1 + limita(frazione, 0, 1))) / passi;
  });
}

/** Il passo che sale dolce: 0 sotto a, 1 sopra b, continuo con la derivata. */
const passoDolce = (z: number, a: number, b: number): number => {
  const t = limita((z - a) / Math.max(b - a, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Quota massima della vita: sotto il punto anteriore della seduta di almeno 6 mm o del 15 % del corpo, così il petto
 * ha spazio per aprirsi ad arco.
 * @param p - I parametri.
 * @returns La quota (mm dal suolo).
 * @public
 */
export function quotaMassimaVita(p: ParametriTacco): number {
  const corpo = p.tacco.altezza - p.tappo.altezza;
  const fronte = p.tacco.altezza - p.seduta.lunghezza * Math.sin(radianti(p.seduta.inclinazione));
  return fronte - Math.max(6, 0.15 * corpo);
}

/**
 * Inclinazione massima della seduta: il punto anteriore resta almeno al 40 % del corpo sopra il tappo.
 * @param p - I parametri.
 * @returns Gradi.
 * @public
 */
export function inclinazioneMassima(p: ParametriTacco): number {
  const corpo = p.tacco.altezza - p.tappo.altezza;
  const seno = Math.min(1, (0.6 * corpo) / Math.max(p.seduta.lunghezza, 1e-6));
  return (Math.asin(seno) * 180) / Math.PI;
}

/** Incavo della seduta (craft): trasversale ≈ 6 % della larghezza, longitudinale ≈ 3 % della lunghezza. */
const incavi = (p: ParametriTacco): { lungo: number; largo: number } => ({
  lungo: Math.min(2, 0.03 * p.seduta.lunghezza),
  largo: Math.min(3, 0.06 * p.seduta.larghezza),
});

/**
 * Quanto la seduta scende sotto il piano per B e F nel punto (x, y): 16u²(1 − u)² lungo la seduta (nullo e piatto in B e
 * in F, così fuori la seduta prosegue nel piano senza spigolo) per l'incavo longitudinale più quello trasversale, una
 * parabola nulla ai fianchi (x = ± metà larghezza).
 * @param seduta - La seduta.
 * @param larghezza - Larghezza della seduta.
 * @param punto - [x, y].
 * @returns La profondità (mm, positiva verso il basso; negativa oltre i fianchi).
 * @public
 */
export function profonditaIncavo(seduta: SedutaTacco, larghezza: number, punto: readonly [number, number]): number {
  const [x, y] = punto;
  const [yB] = seduta.dorso;
  const [yF] = seduta.petto;
  const u = (y - yB) / (yF - yB);
  if (u <= 0 || u >= 1) {
    return 0;
  }
  const lungo = 16 * u * u * (1 - u) * (1 - u);
  return lungo * (seduta.incavoLungo + seduta.incavoLargo * (1 - (2 * x) ** 2 / larghezza ** 2));
}

/**
 * Quota della seduta scavata nel punto (x, y): il piano per B e F meno l'incavo, che è nullo sul dorso, sul petto e
 * massimo al centro (la scarpa sopra è convessa in lungo e in largo). Fuori da B…F resta il piano.
 * @param seduta - La seduta del profilo.
 * @param larghezza - Larghezza della seduta (mm).
 * @param punto - [x, y].
 * @returns La quota z.
 * @public
 */
export function quotaSeduta(seduta: SedutaTacco, larghezza: number, punto: readonly [number, number]): number {
  const [yB, zB] = seduta.dorso;
  const piano = zB - (punto[1] - yB) * Math.tan(seduta.inclinazione);
  return piano - profonditaIncavo(seduta, larghezza, punto);
}

/**
 * Il profilo del tacco dai parametri (già normalizzati) e dalla variante.
 * @param p - I parametri.
 * @param variante - La variante.
 * @returns Sezioni, tappo, seduta, asse.
 * @public
 */
export function profiloTacco(p: ParametriTacco, variante: VarianteTacco): ProfiloTacco {
  const { tacco, seduta, tappo, vita } = p;
  const { altezza } = tacco;
  const zTappo = tappo.altezza;
  const corpo = altezza - zTappo;
  const alfa = radianti(seduta.inclinazione);
  const pianta = seduta.lunghezza * Math.cos(alfa);
  const yDorso = -pianta / 2;
  const yPetto = pianta / 2;
  const zPetto = altezza - seduta.lunghezza * Math.sin(alfa);
  const tanSpinta = Math.tan(radianti(tacco.spinta));
  // L'asse del fusto va dal centro del tappo al centro della seduta (in pianta y = 0, a quota B).
  const yTappo = -corpo * tanSpinta;
  const asseA = (z: number): number => yTappo + (z - zTappo) * tanSpinta;
  const fusto = haFusto(variante);
  const zVita = fusto
    ? limita(zTappo + vita.quota * corpo, zTappo + 0.12 * corpo, Math.max(zTappo + 0.12 * corpo, quotaMassimaVita(p)))
    : zTappo;
  const minimo = strettezzaVita(variante);
  const lunghezzaVita = Math.max(vita.scala * seduta.lunghezza, minimo * tappo.lunghezza);
  const larghezzaVita = Math.max(vita.scala * seduta.larghezza, minimo * tappo.larghezza);

  const dorsoTappo = yTappo - tappo.lunghezza / 2;
  const pettoTappo = yTappo + tappo.lunghezza / 2;
  const dorsoVita = asseA(zVita) - lunghezzaVita / 2;
  const pettoVita = asseA(zVita) + lunghezzaVita / 2;
  // Con dorso.bombatura > 0 il dorso va verso −Y (convesso); con fronte.bombatura > 0 il petto va verso +Y.
  const bombaDorso = -p.dorso.bombatura;
  const bombaPetto = p.fronte.bombatura;

  // Il dorso si raddrizza negli ultimi 4 mm sotto B (al più un quarto del tratto).
  const cimaDorso = Math.min(4, 0.25 * (altezza - zVita));
  // La larghezza (vista da dietro) si raddrizza negli ultimi 5 mm sotto il punto anteriore della seduta.
  const cimaLarghezza = Math.min(5, 0.3 * (zPetto - zVita));
  type Leggi = { dorso: Linea; petto: Linea; larghezza: Linea };
  const leggi = ((): Leggi => {
    if (!fusto) {
      // Blocco e cono: dritti dal tappo alla seduta, più la bombatura ad arco b·4u(1−u), scritta come retta più un
      // termine in u² (pendenza iniziale più ripida, u² che la richiude in cima).
      const arco = (
        [z0, v0]: readonly [number, number],
        [z1, v1]: readonly [number, number],
        bombatura: number,
      ): Tratto => ({
        z0,
        z1,
        v0,
        v1,
        pendenza0: pendenzaRetta([z0, v0], [z1, v1]) + (4 * bombatura) / (z1 - z0),
        esponente: 2,
        bombatura: 0,
      });
      return {
        dorso: {
          tratti: [{ ...arco([zTappo, dorsoTappo], [altezza, yDorso], bombaDorso), cimaVerticale: cimaDorso }],
          oltre: 0,
        },
        petto: { tratti: [arco([zTappo, pettoTappo], [zPetto, yPetto], bombaPetto)], oltre: 0.3 * pianta },
        // Vista da dietro la larghezza cresce dritta fino al punto anteriore della seduta (pendenza piccola: lo spigolo
        // sopra non fa ondeggiare il loft).
        larghezza: {
          tratti: [
            {
              z0: zTappo,
              z1: zPetto,
              v0: tappo.larghezza,
              v1: seduta.larghezza,
              pendenza0: 0,
              esponente: 1,
              bombatura: 0,
            },
          ],
          oltre: 0,
        },
      };
    }
    const sotto = (v0: number, v1: number): Tratto =>
      variante === 'rocchetto'
        ? // Rocchetto: dalla vita (tangente verticale) verso il tappo che si riapre.
          {
            z0: zTappo,
            z1: zVita,
            v0,
            v1,
            pendenza0: (2 * (v1 - v0)) / (zVita - zTappo),
            esponente: 2,
            bombatura: 0,
          }
        : {
            z0: zTappo,
            z1: zVita,
            v0,
            v1,
            pendenza0: pendenzaRetta([zTappo, v0], [zVita, v1]),
            esponente: 1,
            bombatura: 0,
          };
    // Pendenza in cima al tratto sotto la vita: la continua il tratto sopra (0 nel rocchetto, la vita è verticale).
    const pendenzaVita = (tratto: Tratto): number => (variante === 'rocchetto' ? 0 : pendenzaFinale(tratto));
    const dorsoSotto = sotto(dorsoTappo, dorsoVita);
    const pettoSotto = sotto(pettoTappo, pettoVita);
    const larghezzaSotto = sotto(tappo.larghezza, larghezzaVita);
    return {
      dorso: {
        tratti: [
          dorsoSotto,
          {
            z0: zVita,
            z1: altezza,
            v0: dorsoVita,
            v1: yDorso,
            pendenza0: pendenzaVita(dorsoSotto),
            esponente: 1.7,
            bombatura: bombaDorso,
            cimaVerticale: cimaDorso,
          },
        ],
        oltre: 0,
      },
      petto: {
        tratti: [
          pettoSotto,
          {
            z0: zVita,
            z1: zPetto,
            v0: pettoVita,
            v1: yPetto,
            pendenza0: pendenzaVita(pettoSotto),
            esponente: 2.2,
            bombatura: bombaPetto,
          },
        ],
        oltre: 0.3 * pianta,
      },
      larghezza: {
        tratti: [
          larghezzaSotto,
          // Da dietro si apre concava (u²) fino quasi alla seduta, e negli ultimi mm si raddrizza: niente «fungo».
          {
            z0: zVita,
            z1: zPetto,
            v0: larghezzaVita,
            v1: seduta.larghezza,
            pendenza0: pendenzaVita(larghezzaSotto),
            esponente: 2,
            bombatura: 0,
            cimaVerticale: cimaLarghezza,
          },
        ],
        oltre: 0,
      },
    };
  })();

  const formaTappo: FormaSeduta = tappo.forma === 'come_seduta' ? seduta.forma : tappo.forma;
  const piantaTappo = formaPianta(formaTappo, {
    larghezza: tappo.larghezza,
    lunghezza: tappo.lunghezza,
    raggio: seduta.raggioAngoli * Math.min(tappo.larghezza / seduta.larghezza, 1),
    seduta: false,
  });
  const piantaSeduta = formaPianta(seduta.forma, {
    larghezza: seduta.larghezza,
    lunghezza: seduta.lunghezza,
    raggio: seduta.raggioAngoli,
    seduta: true,
  });
  // La pianta passa da quella del tappo (fino alla vita) a quella della seduta (dal punto anteriore in su).
  const inizioPianta = fusto ? zVita : zTappo;
  const sezioneA = (z: number): SezioneTacco => {
    const peso = passoDolce(z, inizioPianta, zPetto);
    const dorso = valoreLinea(leggi.dorso, z);
    const petto = Math.max(valoreLinea(leggi.petto, z), dorso + 1);
    return {
      z,
      dorso,
      petto,
      larghezza: Math.max(1, valoreLinea(leggi.larghezza, z)),
      esponenteDorso: piantaTappo.esponenteDorso + (piantaSeduta.esponenteDorso - piantaTappo.esponenteDorso) * peso,
      esponentePetto: piantaTappo.esponentePetto + (piantaSeduta.esponentePetto - piantaTappo.esponentePetto) * peso,
      largo: piantaTappo.largo + (piantaSeduta.largo - piantaTappo.largo) * peso,
    };
  };

  const { lungo, largo } = incavi(p);
  // Stazioni del loft: un numero fisso, distribuite con una densità che cresce dolce dal fusto dritto (rada) a dove il
  // tacco si apre (fitta). Il loft passa per le sezioni con un parametro uniforme (una sezione = un passo): intervalli
  // vicini di lunghezza molto diversa lo fanno ondeggiare (un fusto lungo con due sole sezioni diventa a onde).
  const densita = (z: number): number =>
    fusto
      ? 1 + 2 * passoDolce(z, zTappo, zVita) - 0.5 * passoDolce(z, zPetto, zPetto + 4)
      : 1 + passoDolce(z, zTappo + 0.5 * (zPetto - zTappo), zPetto);
  const quote = distribuisci([zTappo, altezza], fusto ? 11 : 8, densita);
  // La scorta sopra la seduta: un passo come l'ultimo.
  const tetto = altezza + Math.max(2, altezza - quote.at(-2)!);
  quote.push(tetto);
  const sezioni = quote.map((z) => sezioneA(z));
  return {
    sezioni,
    tappo: { ...sezioneA(zTappo), z: 0 },
    seduta: {
      dorso: [yDorso, altezza],
      petto: [yPetto, zPetto],
      inclinazione: alfa,
      incavoLungo: lungo,
      incavoLargo: largo,
    },
    ...(fusto ? { vita: zVita } : {}),
    tetto,
    asse: {
      base: [yTappo, zTappo],
      direzione: [Math.sin(radianti(tacco.spinta)), Math.cos(radianti(tacco.spinta))],
    },
    sezioneA,
  };
}

// ─── Telaio della seduta, perno, cavità ──────────────────────────────────────────────────────────────────────────

/**
 * Dal telaio della seduta al piano di simmetria: `s` lungo la seduta da B verso il petto, `h` profondità sotto il piano
 * della seduta (lungo la sua normale, che guarda in alto e in avanti).
 * @param seduta - La seduta.
 * @param s - Distanza lungo la seduta da B.
 * @param h - Profondità sotto il piano.
 * @returns [y, z].
 * @public
 */
export function puntoDaSeduta(seduta: SedutaTacco, s: number, h: number): [number, number] {
  const [yB, zB] = seduta.dorso;
  const a = seduta.inclinazione;
  return [yB + s * Math.cos(a) - h * Math.sin(a), zB - s * Math.sin(a) - h * Math.cos(a)];
}

/**
 * Dal piano di simmetria al telaio della seduta.
 * @param seduta - La seduta.
 * @param punto - [y, z].
 * @returns [s, h].
 * @public
 */
export function sedutaDaPunto(seduta: SedutaTacco, punto: readonly [number, number]): [number, number] {
  const [yB, zB] = seduta.dorso;
  const a = seduta.inclinazione;
  const dy = punto[0] - yB;
  const dz = punto[1] - zB;
  return [dy * Math.cos(a) - dz * Math.sin(a), -(dy * Math.sin(a) + dz * Math.cos(a))];
}

/**
 * La seduta dai soli parametri (non dipende dalla variante): serve anche ai valori derivati.
 * @param p - I parametri.
 * @returns La seduta.
 * @public
 */
export function sedutaDi(p: ParametriTacco): SedutaTacco {
  const alfa = radianti(p.seduta.inclinazione);
  const pianta = p.seduta.lunghezza * Math.cos(alfa);
  const { lungo, largo } = incavi(p);
  return {
    dorso: [-pianta / 2, p.tacco.altezza],
    petto: [pianta / 2, p.tacco.altezza - p.seduta.lunghezza * Math.sin(alfa)],
    inclinazione: alfa,
    incavoLungo: lungo,
    incavoLargo: largo,
  };
}

/** Il perno d'acciaio entra 2 mm nel tappo e si ferma 6 mm sotto la seduta scavata. */
const pernoNelTappo = 2;
const pernoSottoSeduta = 6;

/**
 * Il perno: base (2 mm dentro il tappo, sull'asse inclinato della spinta), direzione e lunghezza fino a 6 mm sotto la
 * seduta.
 * @param p - I parametri.
 * @returns Base [y, z], direzione [dy, dz] unitaria, lunghezza.
 * @public
 */
export function assePerno(p: ParametriTacco): {
  base: [number, number];
  direzione: [number, number];
  lunghezza: number;
} {
  const spinta = radianti(p.tacco.spinta);
  const corpo = p.tacco.altezza - p.tappo.altezza;
  const zBase = p.tappo.altezza - pernoNelTappo;
  const base: [number, number] = [-corpo * Math.tan(spinta) - pernoNelTappo * Math.tan(spinta), zBase];
  const direzione: [number, number] = [Math.sin(spinta), Math.cos(spinta)];
  const seduta = sedutaDi(p);
  const { larghezza } = p.seduta;
  const margine = (lunghezza: number): number => {
    const y = base[0] + lunghezza * direzione[0];
    const z = base[1] + lunghezza * direzione[1];
    return quotaSeduta(seduta, larghezza, [0, y]) - pernoSottoSeduta - z;
  };
  let basso = 0;
  let alto = p.tacco.altezza * 1.5;
  if (margine(basso) <= 0) {
    return { base, direzione, lunghezza: 0 };
  }
  for (let giro = 0; giro < 50; giro++) {
    const medio = (basso + alto) / 2;
    if (margine(medio) > 0) {
      basso = medio;
    } else {
      alto = medio;
    }
  }
  return { base, direzione, lunghezza: Math.round(basso * 10) / 10 };
}

/** Una sezione della cavità, nel telaio della seduta: profondità, estremi lungo la seduta, mezza larghezza. */
export type SezioneCavita = Readonly<{ h: number; dorso: number; petto: number; mezza: number }>;

/**
 * La cavità di svuotamento dalla seduta: superellissi concentriche (stesso centro `centro` lungo la seduta, stessi
 * esponenti) su piani paralleli alla seduta, ciascuna dentro quella sopra: si estrae lungo la normale della seduta
 * con lo sformo dato, e le pareti stanno ad almeno `parete` dalla superficie esterna (erosione con una sfera).
 * @public
 */
export type CavitaTacco = Readonly<{
  sezioni: readonly SezioneCavita[];
  centro: number;
  esponenteDorso: number;
  esponentePetto: number;
}>;

/**
 * La sezione della cavità come sezione di tacco nel telaio della seduta (y → s, z → h), per il contorno.
 * @param cavita - La cavità.
 * @param sezione - Una sua sezione.
 * @returns La sezione da passare a {@link contornoSezione}.
 * @public
 */
export const sezioneDiCavita = (cavita: CavitaTacco, sezione: SezioneCavita): SezioneTacco => ({
  z: sezione.h,
  dorso: sezione.dorso,
  petto: sezione.petto,
  larghezza: 2 * sezione.mezza,
  esponenteDorso: cavita.esponenteDorso,
  esponentePetto: cavita.esponentePetto,
  largo: (cavita.centro - sezione.dorso) / (sezione.petto - sezione.dorso),
});

/** Passo delle griglie della cavità (mm). */
const passoCavita = 0.5;

/**
 * La cavità di svuotamento, o niente se non c'è spazio.
 * @param p - I parametri.
 * @param profilo - Il profilo del tacco.
 * @param opzioni - Quota minima del fondo (z), margine aggiunto alla parete per l'interpolazione del loft.
 * @returns La cavità.
 * @public
 */
export function cavitaTacco(
  p: ParametriTacco,
  profilo: ProfiloTacco,
  opzioni: { quotaMinima: number; margine?: number },
): CavitaTacco | undefined {
  const { seduta } = profilo;
  const parete = p.costruzione.parete + (opzioni.margine ?? 0.25);
  const tanSformo = Math.tan(radianti(p.costruzione.sformo + 1));
  const zTappo = p.tappo.altezza;
  // Campioni del dorso e del petto sul piano di simmetria, nel telaio della seduta.
  const campioniLinee = (lato: 'dorso' | 'petto'): Array<[number, number]> => {
    const punti: Array<[number, number]> = [];
    for (let z = zTappo; z <= profilo.tetto + 1e-9; z += 0.25) {
      const sezione = profilo.sezioneA(z);
      punti.push(sedutaDaPunto(seduta, [lato === 'dorso' ? sezione.dorso : sezione.petto, z]));
    }
    return punti;
  };
  const dorsi = campioniLinee('dorso');
  const petti = campioniLinee('petto');
  const vincoloLinea = (punti: ReadonlyArray<[number, number]>, h: number, verso: 1 | -1): number => {
    let estremo = verso === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (const [s, hi] of punti) {
      const dh = h - hi;
      if (Math.abs(dh) < parete) {
        const valore = s + verso * Math.sqrt(parete * parete - dh * dh);
        estremo = verso === 1 ? Math.max(estremo, valore) : Math.min(estremo, valore);
      }
    }
    return estremo;
  };
  // Mezza larghezza esterna sulla griglia (s, h); fuori dal corpo 0.
  const sMinimo = -8;
  const sMassimo = p.seduta.lunghezza + 0.4 * p.seduta.lunghezza + 8;
  const hMinimo = -1.5;
  const hMassimo = p.tacco.altezza;
  const colonne = Math.ceil((sMassimo - sMinimo) / passoCavita) + 1;
  const righe = Math.ceil((hMassimo - hMinimo) / passoCavita) + 1;
  const esterna = new Float64Array(colonne * righe);
  for (let r = 0; r < righe; r++) {
    const h = hMinimo + r * passoCavita;
    for (let c = 0; c < colonne; c++) {
      const [y, z] = puntoDaSeduta(seduta, sMinimo + c * passoCavita, h);
      // Sopra il tetto la scorta continua (verrà tagliata dalla seduta): conta come materiale.
      esterna[r * colonne + c] = z < zTappo ? 0 : mezzaLarghezzaA(profilo.sezioneA(Math.min(z, profilo.tetto)), y);
    }
  }
  // Erosione con una sfera di raggio `parete`: la mezza larghezza che resta a `parete` dalla superficie.
  const scostamenti: Array<[number, number, number]> = [];
  const passi = Math.ceil(parete / passoCavita);
  for (let dr = -passi; dr <= passi; dr++) {
    for (let dc = -passi; dc <= passi; dc++) {
      const quadrato = parete * parete - (dr * passoCavita) ** 2 - (dc * passoCavita) ** 2;
      if (quadrato >= 0) {
        scostamenti.push([dr, dc, Math.sqrt(quadrato)]);
      }
    }
  }
  const erosaA = (r: number, c: number): number => {
    let minimo = Number.POSITIVE_INFINITY;
    for (const [dr, dc, raggio] of scostamenti) {
      // Sopra e sotto la griglia vale la riga più vicina (sopra c'è la scorta); fuori in larghezza non c'è materiale.
      const rr = limita(r + dr, 0, righe - 1);
      const cc = c + dc;
      const valore = cc < 0 || cc >= colonne ? 0 : esterna[rr * colonne + cc]!;
      minimo = Math.min(minimo, valore - raggio);
    }
    return minimo;
  };
  // Il centro (punto più largo) appena sotto il piano della seduta, e gli esponenti della pianta lì.
  const rigaSeduta = Math.round((1 - hMinimo) / passoCavita);
  let colonnaCentro = 0;
  for (let c = 0; c < colonne; c++) {
    if (esterna[rigaSeduta * colonne + c]! > esterna[rigaSeduta * colonne + colonnaCentro]!) {
      colonnaCentro = c;
    }
  }
  const centro = sMinimo + colonnaCentro * passoCavita;
  const [, zCentro] = puntoDaSeduta(seduta, centro, 1);
  const pianta = profilo.sezioneA(zCentro);
  const forma = { esponenteDorso: pianta.esponenteDorso, esponentePetto: pianta.esponentePetto };
  const sezioni: SezioneCavita[] = [];
  let sopra: SezioneCavita | undefined;
  for (let r = 0; r < righe; r++) {
    const h = hMinimo + r * passoCavita;
    // Sopra la seduta il petto è solo scorta (verrà tagliata): la cavità non va oltre il punto anteriore.
    let dorso = vincoloLinea(dorsi, h, 1);
    let petto = Math.min(vincoloLinea(petti, h, -1), p.seduta.lunghezza - parete / 2);
    if (sopra) {
      dorso = Math.max(dorso, sopra.dorso + passoCavita * tanSformo);
      petto = Math.min(petto, sopra.petto - passoCavita * tanSformo);
    }
    const [, zFondo] = puntoDaSeduta(seduta, centro, h);
    if (centro - dorso < 3 || petto - centro < 3 || zFondo < opzioni.quotaMinima) {
      break;
    }
    const sagoma = { ...forma, z: h, dorso, petto, larghezza: 2, largo: (centro - dorso) / (petto - dorso) };
    let mezza = Number.POSITIVE_INFINITY;
    for (let c = 0; c < colonne; c++) {
      const s = sMinimo + c * passoCavita;
      const unitaria = mezzaLarghezzaA(sagoma, s);
      if (unitaria >= 0.3) {
        mezza = Math.min(mezza, erosaA(r, c) / unitaria);
      }
    }
    if (sopra) {
      mezza = Math.min(mezza, sopra.mezza - passoCavita * tanSformo);
    }
    if (!(mezza >= 3)) {
      break;
    }
    sopra = { h, dorso, petto, mezza };
    sezioni.push(sopra);
  }
  if (sezioni.length === 0 || sezioni.at(-1)!.h < 4) {
    return undefined;
  }
  return { sezioni, centro, ...forma };
}

/**
 * Fin dove può scendere un foro lungo la normale della seduta restando a una parete dalla superficie esterna: dal
 * piano della seduta, a passi di 0,5 mm, finché il cerchio del foro più la parete (ellisse nella sezione orizzontale,
 * perché il foro è inclinato come la seduta) sta dentro la pianta a quella quota.
 * @param profilo - Il profilo del tacco.
 * @param foro - Posizione nel telaio della seduta [x, s], raggio, parete, profondità massima voluta.
 * @returns La profondità sicura sotto il piano della seduta (mm), al più `massima`.
 * @public
 */
export function profonditaForo(
  profilo: ProfiloTacco,
  foro: Readonly<{ x: number; s: number; raggio: number; parete: number; massima: number }>,
): number {
  const { seduta } = profilo;
  const raggio = foro.raggio + foro.parete;
  const lungo = raggio / Math.cos(seduta.inclinazione);
  let profondita = 0;
  for (let h = 0; h <= foro.massima + 1e-9; h += 0.5) {
    const [y, z] = puntoDaSeduta(seduta, foro.s, h);
    const sezione = profilo.sezioneA(z);
    const dentro = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4).every((angolo) =>
      dentroSezione(sezione, [foro.x + raggio * Math.cos(angolo), y + lungo * Math.sin(angolo)]),
    );
    if (!dentro) {
      break;
    }
    profondita = h;
  }
  return profondita;
}
