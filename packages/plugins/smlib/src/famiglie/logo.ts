import type * as Smlib from '@classcad/smlibwasm';
import type { ContornoLogo, LogoLetto, Punto2 } from '#famiglie/logo-svg.js';

/**
 * Il logo come profilo del kernel (E3b): dai contorni letti da `logo-svg.ts` allo schizzo su XY, in scala e in
 * posizione sulla faccia. Lo schizzo si estrude come il testo: in rilievo o in incisione.
 */

type Lib = typeof Smlib;

const area = (punti: readonly Punto2[]): number => {
  let somma = 0;
  for (const [indice, [x, y]] of punti.entries()) {
    const [xn, yn] = punti[(indice + 1) % punti.length]!;
    somma += x * yn - xn * y;
  }
  return Math.abs(somma / 2);
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

/**
 * Lo schizzo del logo: ogni contorno pieno meno i buchi che ha dentro, centrato sul punto dato.
 * @param lib - Libreria SMLib.
 * @param logo - Il logo letto.
 * @param posa - `larghezza` (mm) a cui si porta l'ingombro del logo, e il centro `x`, `y` sulla faccia (mm).
 * @returns Lo schizzo su XY, con la normale in +Z.
 * @public
 */
export function schizzoLogo(
  lib: Lib,
  logo: LogoLetto,
  posa: Readonly<{ larghezza: number; x: number; y: number }>,
): Smlib.Sketch {
  const scala = posa.larghezza / logo.larghezza;
  const sposta = (punti: readonly Punto2[]): Array<[number, number]> =>
    punti.map(([x, y]) => [(x - logo.larghezza / 2) * scala + posa.x, (y - logo.altezza / 2) * scala + posa.y]);
  const pieni = logo.contorni.filter(({ buco }) => !buco);
  const buchi = logo.contorni.filter(({ buco }) => buco);
  // Ogni buco appartiene al più piccolo contorno pieno che lo contiene.
  const dellePieno = new Map<ContornoLogo, ContornoLogo[]>(pieni.map((pieno) => [pieno, []]));
  for (const buco of buchi) {
    const proprietario = pieni
      .filter((pieno) => dentro(buco.punti[0]!, pieno.punti))
      .toSorted((a, b) => area(a.punti) - area(b.punti))[0];
    if (proprietario) {
      dellePieno.get(proprietario)!.push(buco);
    }
  }
  const schizzi = pieni.map((pieno) => {
    const esterno = lib.Polygon(sposta(pieno.punti));
    const fori = dellePieno.get(pieno)!;
    return fori.length > 0 ? esterno.cut(...fori.map((buco) => lib.Polygon(sposta(buco.punti)))) : esterno;
  });
  const [primo, ...altri] = schizzi;
  return altri.length > 0 ? primo!.fuse(...altri) : primo!;
}
