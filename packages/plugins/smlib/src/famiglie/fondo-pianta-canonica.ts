/**
 * Pianta canonica del fondo (T-D1-06): 24 punti normalizzati per la lunghezza, y = 0 al tallone e 1 alla punta,
 * ricavati una volta dalla forma demo `sample_last.glb` (fixture di Sinopia `services/flatten-service/tests/fixtures`,
 * 272 mm) con `scripts/src/pianta-da-forma.ts`: semilarghezza della zona d'appoggio a 11 stazioni per fianco.
 *
 * Scelta nostra, dichiarata: la forma demo è simmetrica (stesso fianco interno ed esterno) e ha il fondo piano; il
 * fondificio sviluppa sulla forma campione vera (verifica `GRADING`).
 */
export const piantaCanonica: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.1129, 0.015],
  [0.1229, 0.05],
  [0.1378, 0.1],
  [0.1533, 0.18],
  [0.1653, 0.28],
  [0.1771, 0.4],
  [0.18, 0.52],
  [0.1829, 0.64],
  [0.1809, 0.74],
  [0.156, 0.84],
  [0.1116, 0.93],
  [0, 1],
  [-0.1116, 0.93],
  [-0.156, 0.84],
  [-0.1809, 0.74],
  [-0.1829, 0.64],
  [-0.18, 0.52],
  [-0.1771, 0.4],
  [-0.1653, 0.28],
  [-0.1533, 0.18],
  [-0.1378, 0.1],
  [-0.1229, 0.05],
  [-0.1129, 0.015],
];

/** Stazione del centro del tallone (origine della pianta) e della linea delle teste metatarsali (pianta). */
export const STAZIONE_TALLONE = 0.18;
export const STAZIONE_PIANTA = 0.64;

/** Larghezze della pianta canonica (frazioni della lunghezza) al tallone e alla pianta. */
const larghezzaCanonicaTallone = 2 * 0.1533;
const larghezzaCanonicaPianta = 2 * 0.1829;

/**
 * Lunghezza della pianta da una taglia EU: piede = taglia × 2/3 cm, più 12 mm di calzata e sormonto (ipotesi
 * dichiarata della specifica §1.2).
 * @param taglia - Taglia EU (35–47).
 * @returns Millimetri.
 */
export const lunghezzaDaTaglia = (taglia: number): number => taglia * 6.667 + 12;

/** Una pianta in millimetri: contorno chiuso (+Y verso la punta, origine sotto il centro del tallone) e misure. */
export type Pianta = {
  contorno: [number, number][];
  lunghezza: number;
  larghezzaPianta: number;
  larghezzaTallone: number;
  /** Y della punta e del tallone (estremi del contorno). */
  yPunta: number;
  yTallone: number;
};

const raccordo = (u: number): number => {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
};

/**
 * La pianta di una lunghezza e due larghezze: la canonica scalata in lunghezza, e in larghezza col fattore del tallone
 * fino al tallone e con quello della pianta dalla linea delle teste in avanti, raccordati fra le due.
 * @param misure - Lunghezza e larghezze in mm (default 0,37 e 0,25 della lunghezza).
 * @returns Contorno e misure.
 */
export function piantaDaMisure(misure: {
  lunghezza: number;
  larghezzaPianta?: number;
  larghezzaTallone?: number;
}): Pianta {
  const { lunghezza } = misure;
  const larghezzaPianta = misure.larghezzaPianta ?? 0.37 * lunghezza;
  const larghezzaTallone = misure.larghezzaTallone ?? 0.25 * lunghezza;
  const fattoreTallone = larghezzaTallone / (larghezzaCanonicaTallone * lunghezza);
  const fattorePianta = larghezzaPianta / (larghezzaCanonicaPianta * lunghezza);
  const contorno = piantaCanonica.map(([x, y]): [number, number] => {
    const peso = raccordo((y - STAZIONE_TALLONE) / (STAZIONE_PIANTA - STAZIONE_TALLONE));
    const fattore = fattoreTallone + (fattorePianta - fattoreTallone) * peso;
    return [x * lunghezza * fattore, (y - STAZIONE_TALLONE) * lunghezza];
  });
  return {
    contorno,
    lunghezza,
    larghezzaPianta,
    larghezzaTallone,
    yPunta: (1 - STAZIONE_TALLONE) * lunghezza,
    yTallone: -STAZIONE_TALLONE * lunghezza,
  };
}

/**
 * La pianta di una taglia EU con le larghezze in proporzione (0,37 e 0,25 della lunghezza).
 * @param taglia - Taglia EU.
 * @returns Contorno e misure.
 */
export const piantaDaTaglia = (taglia: number): Pianta => piantaDaMisure({ lunghezza: lunghezzaDaTaglia(taglia) });

/**
 * Se un poligono chiuso non si autointerseca (lati non adiacenti che non si toccano).
 * @param punti - Vertici in ordine.
 * @returns True se semplice.
 */
export function poligonoSemplice(punti: readonly (readonly [number, number])[]): boolean {
  const n = punti.length;
  if (n < 3) {
    return false;
  }
  const incrocia = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    d: readonly [number, number],
  ): boolean => {
    const lato = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): number =>
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = lato(c, d, a);
    const d2 = lato(c, d, b);
    const d3 = lato(a, b, c);
    const d4 = lato(a, b, d);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) {
        continue;
      }
      if (incrocia(punti[i]!, punti[(i + 1) % n]!, punti[j]!, punti[(j + 1) % n]!)) {
        return false;
      }
    }
  }
  return true;
}
