import { poligonoSemplice } from '#famiglie/fondo-pianta-canonica.js';

/**
 * Il logo da SVG (E3b): dall'SVG ai contorni chiusi del logo, in millimetri-unità-SVG con Y in alto, pronti per
 * diventare un profilo da estrudere in rilievo o in incisione sulla faccia di una placca.
 *
 * Questo file è puro (nessun kernel). Legge i contorni pieni: `path` (M L H V C S Q T A Z, assoluti e relativi),
 * `rect`, `circle`, `ellipse`, `polygon`, `polyline`. Le curve si spezzano in segmenti (`passiCurva` per curva). I
 * sottopercorsi si annidano con la regola pari-dispari: un contorno dentro un altro è un buco (la O, il foro di una
 * A). Un contorno aperto o che si autointerseca non è un profilo: lancia `ErroreLogo` col suo codice. I tratti
 * senza riempimento (`fill="none"`) e le trasformazioni non si leggono e vengono segnalati negli avvisi.
 */

/**
 * Un punto del contorno.
 * @public
 */
export type Punto2 = readonly [number, number];

/**
 * Un contorno chiuso; `buco` se sta dentro un contorno pieno (profondità di annidamento dispari).
 * @public
 */
export type ContornoLogo = Readonly<{ punti: readonly Punto2[]; buco: boolean }>;

/**
 * Il logo letto: contorni e ingombro (nell'unità dell'SVG, Y in alto, minimo in 0,0).
 * @public
 */
export type LogoLetto = Readonly<{
  contorni: readonly ContornoLogo[];
  larghezza: number;
  altezza: number;
  avvisi: readonly string[];
}>;

/**
 * Perché un SVG non diventa un profilo.
 * @public
 */
export type CodiceErroreLogo = 'SVG_NON_VALIDO' | 'SVG_VUOTO' | 'SVG_APERTO' | 'SVG_AUTOINTERSECANTE';

/**
 * L'errore di lettura del logo, con il suo codice e una frase in italiano.
 * @public
 */
export class ErroreLogo extends Error {
  readonly codice: CodiceErroreLogo;

  constructor(codice: CodiceErroreLogo, messaggio: string) {
    super(messaggio);
    this.name = 'ErroreLogo';
    this.codice = codice;
  }
}

/** Segmenti con cui si approssima una curva di Bézier o un arco. */
const passiCurva = 16;
/** Due punti più vicini di questo (unità SVG, relativo all'ingombro) sono lo stesso punto. */
const tolleranzaChiusura = 1e-3;

const attributo = (tag: string, nome: string): string | undefined => {
  const trovato = new RegExp(String.raw`(?:^|\s)${nome}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return trovato ? (trovato[1] ?? trovato[2]) : undefined;
};

const numeroAttributo = (tag: string, nome: string, predefinito = 0): number => {
  const valore = attributo(tag, nome);
  const numero = valore === undefined ? Number.NaN : Number.parseFloat(valore);
  return Number.isFinite(numero) ? numero : predefinito;
};

type Sottopercorso = { punti: Array<[number, number]>; chiuso: boolean };

const numeri = (testo: string): number[] =>
  [...testo.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map((m) => Number.parseFloat(m[0]));

/** I numeri di un comando `a`: sette per arco, con i due flag di un solo carattere (0 o 1). */
function numeriArco(testo: string): number[] {
  const numero = /[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/iy;
  const flag = /[\s,]*([01])/y;
  const valori: number[] = [];
  let posizione = 0;
  while (posizione < testo.length && /[^\s,]/.test(testo.slice(posizione))) {
    for (const lettore of [numero, numero, numero, flag, flag, numero, numero]) {
      lettore.lastIndex = posizione;
      const trovato = lettore.exec(testo);
      if (!trovato) {
        return valori;
      }
      valori.push(Number.parseFloat(trovato[1]!));
      posizione = lettore.lastIndex;
    }
  }
  return valori;
}

/** Un arco SVG in segmenti (conversione da estremi a centro, appendice F.6 dello standard SVG 1.1). */
function arco(
  da: readonly [number, number],
  parametri: readonly [number, number, number, number, number, number, number],
): Array<[number, number]> {
  const [rxIn, ryIn, rotazione, grande, verso, x, y] = parametri;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((da[0] === x && da[1] === y) || rx === 0 || ry === 0) {
    return [[x, y]];
  }
  const fi = (rotazione * Math.PI) / 180;
  const [cosFi, sinFi] = [Math.cos(fi), Math.sin(fi)];
  const dx = (da[0] - x) / 2;
  const dy = (da[1] - y) / 2;
  const x1 = cosFi * dx + sinFi * dy;
  const y1 = -sinFi * dx + cosFi * dy;
  const scala = x1 ** 2 / rx ** 2 + y1 ** 2 / ry ** 2;
  if (scala > 1) {
    rx *= Math.sqrt(scala);
    ry *= Math.sqrt(scala);
  }
  const numeratore = rx ** 2 * ry ** 2 - rx ** 2 * y1 ** 2 - ry ** 2 * x1 ** 2;
  const denominatore = rx ** 2 * y1 ** 2 + ry ** 2 * x1 ** 2;
  const coefficiente = (grande === verso ? -1 : 1) * Math.sqrt(Math.max(0, numeratore / denominatore));
  const cx1 = (coefficiente * rx * y1) / ry;
  const cy1 = (-coefficiente * ry * x1) / rx;
  const cx = cosFi * cx1 - sinFi * cy1 + (da[0] + x) / 2;
  const cy = sinFi * cx1 + cosFi * cy1 + (da[1] + y) / 2;
  const angolo = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angolo(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angolo((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (verso === 0 && delta > 0) {
    delta -= 2 * Math.PI;
  } else if (verso === 1 && delta < 0) {
    delta += 2 * Math.PI;
  }
  const passi = Math.max(passiCurva, Math.ceil((Math.abs(delta) / (2 * Math.PI)) * passiCurva * 2));
  return Array.from({ length: passi }, (_, k): [number, number] => {
    if (k === passi - 1) {
      return [x, y];
    }
    const t = theta + (delta * (k + 1)) / passi;
    return [
      cosFi * rx * Math.cos(t) - sinFi * ry * Math.sin(t) + cx,
      sinFi * rx * Math.cos(t) + cosFi * ry * Math.sin(t) + cy,
    ];
  });
}

const bezier = (punti: ReadonlyArray<readonly [number, number]>): Array<[number, number]> =>
  Array.from({ length: passiCurva }, (_, k): [number, number] => {
    const t = (k + 1) / passiCurva;
    const u = 1 - t;
    if (punti.length === 3) {
      return [
        u * u * punti[0]![0] + 2 * u * t * punti[1]![0] + t * t * punti[2]![0],
        u * u * punti[0]![1] + 2 * u * t * punti[1]![1] + t * t * punti[2]![1],
      ];
    }
    return [
      u ** 3 * punti[0]![0] + 3 * u * u * t * punti[1]![0] + 3 * u * t * t * punti[2]![0] + t ** 3 * punti[3]![0],
      u ** 3 * punti[0]![1] + 3 * u * u * t * punti[1]![1] + 3 * u * t * t * punti[2]![1] + t ** 3 * punti[3]![1],
    ];
  });

const argomentiComando: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/** Il campo `d` di un `path` in sottopercorsi di punti. */
function leggiPath(d: string): Sottopercorso[] {
  const risultato: Sottopercorso[] = [];
  let corrente: Sottopercorso | undefined;
  let [x, y] = [0, 0];
  let [inizioX, inizioY] = [0, 0];
  // Ultimo punto di controllo (per S e T) e il comando che lo ha dato.
  let controllo: [number, number] | undefined;
  let ultimo = '';
  const sequenze = [...d.matchAll(/([a-z])([^a-z]*)/gi)];
  if (sequenze.length === 0 || !/^\s*[Mm]/.test(d)) {
    throw new ErroreLogo('SVG_NON_VALIDO', 'Il percorso dell’SVG non comincia con un punto (M).');
  }
  for (const [, comando = '', resto = ''] of sequenze) {
    const minuscolo = comando.toLowerCase();
    const relativo = comando === minuscolo;
    const quanti = argomentiComando[minuscolo];
    if (quanti === undefined) {
      throw new ErroreLogo('SVG_NON_VALIDO', `Comando SVG sconosciuto: ${comando}.`);
    }
    // Gli archi possono avere i flag attaccati («a1 1 0 01.5.5»): si leggono uno a uno.
    const valori = minuscolo === 'a' ? numeriArco(resto) : numeri(resto);
    if (quanti === 0) {
      if (corrente) {
        corrente.chiuso = true;
        [x, y] = [inizioX, inizioY];
        // Dopo Z si può proseguire senza M: un nuovo sottopercorso dal punto di partenza.
        corrente = { punti: [[x, y]], chiuso: false };
        risultato.push(corrente);
      }
      controllo = undefined;
      ultimo = minuscolo;
      continue;
    }
    if (valori.length === 0 || valori.length % quanti !== 0) {
      throw new ErroreLogo('SVG_NON_VALIDO', `Comando ${comando} con numeri mancanti nel percorso dell’SVG.`);
    }
    for (let i = 0; i < valori.length; i += quanti) {
      const a = valori.slice(i, i + quanti);
      const [ox, oy] = relativo ? [x, y] : [0, 0];
      const primo = i === 0;
      let comandoEffettivo = minuscolo;
      if (minuscolo === 'm' && !primo) {
        comandoEffettivo = 'l';
      }
      switch (comandoEffettivo) {
        case 'm': {
          x = a[0]! + (primo && !corrente && risultato.length === 0 ? 0 : ox);
          y = a[1]! + (primo && !corrente && risultato.length === 0 ? 0 : oy);
          [inizioX, inizioY] = [x, y];
          corrente = { punti: [[x, y]], chiuso: false };
          risultato.push(corrente);
          controllo = undefined;
          break;
        }
        case 'l':
        case 'h':
        case 'v': {
          if (comandoEffettivo === 'l') {
            [x, y] = [a[0]! + ox, a[1]! + oy];
          } else if (comandoEffettivo === 'h') {
            x = a[0]! + ox;
          } else {
            y = a[0]! + oy;
          }
          corrente?.punti.push([x, y]);
          controllo = undefined;
          break;
        }
        case 'c':
        case 's': {
          const p1: [number, number] =
            comandoEffettivo === 'c'
              ? [a[0]! + ox, a[1]! + oy]
              : controllo && 'cs'.includes(ultimo)
                ? [2 * x - controllo[0], 2 * y - controllo[1]]
                : [x, y];
          const p2: [number, number] = comandoEffettivo === 'c' ? [a[2]! + ox, a[3]! + oy] : [a[0]! + ox, a[1]! + oy];
          const p3: [number, number] = comandoEffettivo === 'c' ? [a[4]! + ox, a[5]! + oy] : [a[2]! + ox, a[3]! + oy];
          corrente?.punti.push(...bezier([[x, y], p1, p2, p3]));
          controllo = p2;
          [x, y] = p3;
          break;
        }
        case 'q':
        case 't': {
          const p1: [number, number] =
            comandoEffettivo === 'q'
              ? [a[0]! + ox, a[1]! + oy]
              : controllo && 'qt'.includes(ultimo)
                ? [2 * x - controllo[0], 2 * y - controllo[1]]
                : [x, y];
          const p2: [number, number] = comandoEffettivo === 'q' ? [a[2]! + ox, a[3]! + oy] : [a[0]! + ox, a[1]! + oy];
          corrente?.punti.push(...bezier([[x, y], p1, p2]));
          controllo = p1;
          [x, y] = p2;
          break;
        }
        default: {
          const fine: [number, number] = [a[5]! + ox, a[6]! + oy];
          corrente?.punti.push(...arco([x, y], [a[0]!, a[1]!, a[2]!, a[3]! ? 1 : 0, a[4]! ? 1 : 0, fine[0], fine[1]]));
          [x, y] = fine;
          controllo = undefined;
        }
      }
      ultimo = comandoEffettivo;
    }
  }
  // Un sottopercorso aperto rimasto dopo uno Z, con il solo punto di partenza, non è un contorno.
  return risultato.filter(({ punti, chiuso }) => chiuso || punti.length > 1);
}

const puntiRettangolo = (x: number, y: number, w: number, h: number): Array<[number, number]> => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const ellisse = (cx: number, cy: number, rx: number, ry: number): Array<[number, number]> =>
  Array.from({ length: 64 }, (_, k): [number, number] => [
    cx + rx * Math.cos((2 * Math.PI * k) / 64),
    cy + ry * Math.sin((2 * Math.PI * k) / 64),
  ]);

/** Area con segno (positiva in senso antiorario). */
const areaConSegno = (punti: readonly Punto2[]): number => {
  let area = 0;
  for (const [indice, [x, y]] of punti.entries()) {
    const [xn, yn] = punti[(indice + 1) % punti.length]!;
    area += x * yn - xn * y;
  }
  return area / 2;
};

const dentro = (punto: Punto2, poligono: readonly Punto2[]): boolean => {
  let interno = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]!;
    const [xj, yj] = poligono[j]!;
    if (yi > punto[1] !== yj > punto[1] && punto[0] < ((xj - xi) * (punto[1] - yi)) / (yj - yi) + xi) {
      interno = !interno;
    }
  }
  return interno;
};

/** Due contorni diversi si incrociano (un lato di uno taglia un lato dell'altro). */
function siIncrociano(a: readonly Punto2[], b: readonly Punto2[]): boolean {
  const lato = (p: Punto2, q: Punto2, r: Punto2): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (const [i, p] of a.entries()) {
    const q = a[(i + 1) % a.length]!;
    for (const [j, r] of b.entries()) {
      const s = b[(j + 1) % b.length]!;
      if (lato(r, s, p) * lato(r, s, q) < 0 && lato(p, q, r) * lato(p, q, s) < 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Legge l'SVG di un logo e ne ricava i contorni chiusi.
 * @param svg - Il testo SVG.
 * @returns I contorni (esterni in senso antiorario, buchi in senso orario), l'ingombro e gli avvisi.
 * @throws ErroreLogo Se l'SVG non è leggibile, non ha contorni pieni, ne ha di aperti o che si autointersecano.
 * @public
 */
export function leggiLogoSvg(svg: string): LogoLetto {
  if (!/<svg[\s>]/i.test(svg)) {
    throw new ErroreLogo('SVG_NON_VALIDO', 'Il testo non è un SVG (manca <svg>).');
  }
  const avvisi: string[] = [];
  const grezzi: Sottopercorso[] = [];
  const tag = svg.match(/<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*>/gi) ?? [];
  if (/\btransform\s*=/i.test(svg)) {
    avvisi.push(
      'Le trasformazioni (transform) dell’SVG non si applicano: esporta l’SVG con i tracciati già convertiti.',
    );
  }
  for (const elemento of tag) {
    const nome = /^<(\w+)/.exec(elemento)![1]!.toLowerCase();
    const riempimento = attributo(elemento, 'fill')?.trim().toLowerCase();
    const stile = attributo(elemento, 'style')?.toLowerCase().replaceAll(/\s/g, '') ?? '';
    if (riempimento === 'none' || stile.includes('fill:none')) {
      avvisi.push(`Un elemento <${nome}> senza riempimento è ignorato: servono contorni pieni, non solo tratti.`);
      continue;
    }
    switch (nome) {
      case 'path': {
        grezzi.push(...leggiPath(attributo(elemento, 'd') ?? ''));
        break;
      }
      case 'rect': {
        const [w, h] = [numeroAttributo(elemento, 'width'), numeroAttributo(elemento, 'height')];
        if (w > 0 && h > 0) {
          grezzi.push({
            punti: puntiRettangolo(numeroAttributo(elemento, 'x'), numeroAttributo(elemento, 'y'), w, h),
            chiuso: true,
          });
        }
        break;
      }
      case 'circle': {
        const r = numeroAttributo(elemento, 'r');
        if (r > 0) {
          grezzi.push({
            punti: ellisse(numeroAttributo(elemento, 'cx'), numeroAttributo(elemento, 'cy'), r, r),
            chiuso: true,
          });
        }
        break;
      }
      case 'ellipse': {
        const [rx, ry] = [numeroAttributo(elemento, 'rx'), numeroAttributo(elemento, 'ry')];
        if (rx > 0 && ry > 0) {
          grezzi.push({
            punti: ellisse(numeroAttributo(elemento, 'cx'), numeroAttributo(elemento, 'cy'), rx, ry),
            chiuso: true,
          });
        }
        break;
      }
      default: {
        const coppie = numeri(attributo(elemento, 'points') ?? '');
        const punti = Array.from({ length: Math.floor(coppie.length / 2) }, (_, k): [number, number] => [
          coppie[2 * k]!,
          coppie[2 * k + 1]!,
        ]);
        // Un polygon si chiude da sé; una polyline vale solo se torna al punto di partenza.
        grezzi.push({ punti, chiuso: nome === 'polygon' });
      }
    }
  }
  if (grezzi.length === 0) {
    throw new ErroreLogo('SVG_VUOTO', 'L’SVG non ha contorni pieni (path, rect, circle, ellipse, polygon).');
  }
  const tutti = grezzi.flatMap(({ punti }) => punti);
  const [x0, x1] = [Math.min(...tutti.map(([x]) => x)), Math.max(...tutti.map(([x]) => x))];
  const [y0, y1] = [Math.min(...tutti.map(([, y]) => y)), Math.max(...tutti.map(([, y]) => y))];
  const [larghezza, altezza] = [x1 - x0, y1 - y0];
  if (!(larghezza > 0) || !(altezza > 0)) {
    throw new ErroreLogo('SVG_VUOTO', 'Il logo non ha un’estensione: tutti i punti sono allineati.');
  }
  const tolleranza = tolleranzaChiusura * Math.max(larghezza, altezza);
  const chiusi = grezzi.map(({ punti, chiuso }, indice) => {
    const primo = punti[0]!;
    const ultimo = punti.at(-1)!;
    const coincide = Math.hypot(primo[0] - ultimo[0], primo[1] - ultimo[1]) <= tolleranza;
    if (!chiuso && !coincide) {
      throw new ErroreLogo(
        'SVG_APERTO',
        `Il contorno ${indice + 1} dell’SVG è aperto: chiudilo (Z) per farne un profilo.`,
      );
    }
    // Il punto finale uguale al primo non si ripete.
    const senzaRipetizione = coincide && punti.length > 1 ? punti.slice(0, -1) : punti;
    // Punti consecutivi coincidenti (un Z subito dopo il ritorno) darebbero lati nulli.
    return senzaRipetizione.filter(
      (p, k) =>
        k === 0 || Math.hypot(p[0] - senzaRipetizione[k - 1]![0], p[1] - senzaRipetizione[k - 1]![1]) > tolleranza / 10,
    );
  });
  // SVG ha Y in basso: si ribalta e si porta il minimo in 0,0.
  const capovolti = chiusi.map((punti): Array<[number, number]> => punti.map(([x, y]) => [x - x0, y1 - y]));
  for (const [indice, punti] of capovolti.entries()) {
    if (punti.length < 3 || Math.abs(areaConSegno(punti)) < 1e-9 || !poligonoSemplice(punti)) {
      throw new ErroreLogo(
        'SVG_AUTOINTERSECANTE',
        `Il contorno ${indice + 1} dell’SVG si autointerseca o non racchiude un’area.`,
      );
    }
  }
  for (const [i, a] of capovolti.entries()) {
    for (const b of capovolti.slice(i + 1)) {
      if (siIncrociano(a, b)) {
        throw new ErroreLogo(
          'SVG_AUTOINTERSECANTE',
          'Due contorni dell’SVG si incrociano: un contorno deve stare dentro l’altro o fuori.',
        );
      }
    }
  }
  const contorni = capovolti.map((punti, indice): ContornoLogo => {
    const profondita = capovolti.filter((altro, k) => k !== indice && dentro(punti[0]!, altro)).length;
    const buco = profondita % 2 === 1;
    // Esterni antiorari, buchi orari: la faccia del profilo guarda +Z.
    const antiorario = areaConSegno(punti) > 0;
    return { punti: antiorario === buco ? punti.toReversed() : punti, buco };
  });
  return { contorni, larghezza, altezza, avvisi };
}

/**
 * Lo spessore minimo del tratto del logo (mm), stimato con raggi interni: da punti campionati lungo i contorni, un
 * raggio perpendicolare verso l'interno del pieno, fino al primo lato che incontra. I punti entro `margine` da un
 * vertice si escludono (una punta aguzza non è un tratto sottile). Più la scala è piccola, più i tratti sono sottili.
 * @param logo - Il logo letto.
 * @param scala - Millimetri per unità SVG.
 * @param margine - Distanza (mm) dai vertici sotto la quale non si campiona.
 * @returns Millimetri; Infinity se non si è potuto misurare.
 * @public
 */
export function trattoMinimoLogo(logo: LogoLetto, scala: number, margine = 0): number {
  const lati: Array<readonly [Punto2, Punto2]> = logo.contorni.flatMap(({ punti }) =>
    punti.map((punto, indice) => [punto, punti[(indice + 1) % punti.length]!] as const),
  );
  const passo = Math.max(0.05, (Math.max(logo.larghezza, logo.altezza) * scala) / 400) / scala;
  const sogliaVertice = margine / scala;
  let minimo = Number.POSITIVE_INFINITY;
  for (const [a, b] of lati) {
    const lunghezza = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (lunghezza < 1e-9) {
      continue;
    }
    // Normale verso l'interno: contorni esterni antiorari e buchi orari hanno il pieno a sinistra del lato.
    const [nx, ny] = [-(b[1] - a[1]) / lunghezza, (b[0] - a[0]) / lunghezza];
    const campioni = Math.max(1, Math.floor(lunghezza / passo));
    for (let k = 0; k < campioni; k++) {
      const t = (k + 0.5) / campioni;
      const distanzaDaA = t * lunghezza;
      if (campioni > 1 && (distanzaDaA < sogliaVertice || lunghezza - distanzaDaA < sogliaVertice)) {
        continue;
      }
      const [px, py] = [a[0] + (b[0] - a[0]) * t + nx * 1e-6, a[1] + (b[1] - a[1]) * t + ny * 1e-6];
      let vicino = Number.POSITIVE_INFINITY;
      for (const [c, d] of lati) {
        if (c === a && d === b) {
          continue;
        }
        // Intersezione del raggio (p + s·n) col lato c-d.
        const [ex, ey] = [d[0] - c[0], d[1] - c[1]];
        const determinante = nx * ey - ny * ex;
        if (Math.abs(determinante) < 1e-12) {
          continue;
        }
        const s = ((c[0] - px) * ey - (c[1] - py) * ex) / determinante;
        const u = ((c[0] - px) * ny - (c[1] - py) * nx) / determinante;
        if (s > 1e-6 && u >= 0 && u <= 1 && s < vicino) {
          vicino = s;
        }
      }
      minimo = Math.min(minimo, vicino);
    }
  }
  return minimo * scala;
}
