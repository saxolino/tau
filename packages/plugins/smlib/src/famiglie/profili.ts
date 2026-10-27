/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';

/**
 * Profili comuni delle famiglie.
 *
 * L'ovale è a quattro centri (archi di cerchio tangenti), non un'ellisse: con gli archi l'estrusione sformata dà coni,
 * i raccordi tori e l'offset archi concentrici, e la fibbia ovale si costruisce in un terzo del tempo dell'ellisse
 * (pareti B-spline). Ai vertici dell'asse maggiore il raggio è quello di curvatura dell'ellisse (b²/a); gli archi
 * dei fianchi sono tangenti a quelli. L'ingombro è esatto (2a × 2b); fra i vertici l'ovale si scosta dall'ellisse
 * dell'1–3 % di b per rapporti a/b fino a 2.
 */

/**
 * I raggi e i centri di un ovale a quattro centri di semiassi a ≥ b.
 * @public
 */
export function ovaleQuattroCentri(a: number, b: number): { r1: number; r2: number; angolo: number } {
  const r1 = (b * b) / a;
  const r2 = (a * (a + b)) / (2 * b);
  // Angolo (rad) del punto di raccordo, visto dal centro dell'arco piccolo.
  const angolo = Math.atan2(r2 - b, a - r1);
  return { r1, r2, angolo };
}

/**
 * Un ovale a quattro centri centrato su XY: semiasse `x` lungo X, `y` lungo Y.
 * @param lib - Libreria SMLib.
 * @param x - Semiasse lungo X.
 * @param y - Semiasse lungo Y.
 * @returns Lo schizzo.
 * @public
 */
export function ovale(lib: typeof Smlib, x: number, y: number): Smlib.Sketch {
  if (Math.abs(x - y) < 1e-6 * Math.max(x, y)) {
    return lib.Circle(x);
  }
  const ruotato = y > x;
  const a = ruotato ? y : x;
  const b = ruotato ? x : y;
  const { r1, r2, angolo } = ovaleQuattroCentri(a, b);
  const gradi = (angolo * 180) / Math.PI;
  const archi = [
    lib.CenterArc([a - r1, 0], r1, -gradi, 2 * gradi),
    lib.CenterArc([0, b - r2], r2, gradi, 180 - 2 * gradi),
    lib.CenterArc([-(a - r1), 0], r1, 180 - gradi, 2 * gradi),
    lib.CenterArc([0, r2 - b], r2, 180 + gradi, 180 - 2 * gradi),
  ];
  const schizzo = lib.makeFace(new lib.Wire(archi));
  return ruotato ? schizzo.rotate(lib.Z, 90) : schizzo;
}

/**
 * Estrude uno schizzo e ne sforma i fianchi attorno al piano dello schizzo: per `altezza` positiva il pezzo si
 * restringe salendo (estrazione verso +Z), per negativa scendendo. Estrusione dritta + `draft` dei fianchi (piani,
 * cilindri → coni): sugli archi è 5–7 volte più rapido di `extrude` con `taper`, che sui fori e sugli archi tangenti
 * fra loro dà pareti B-spline (anello ovale: 540 ms contro ≈ 80). Se il kernel rifiuta il `draft` (fianchi B-spline)
 * si torna al `taper`.
 * @param lib - Libreria SMLib.
 * @param schizzo - Schizzo posato su un piano orizzontale.
 * @param misure - Altezza con segno e sformo in gradi (0 = dritto).
 * @returns Il solido.
 * @public
 */
export function estrudiSformato(
  lib: typeof Smlib,
  schizzo: Smlib.Sketch,
  misure: { altezza: number; sformo: number },
): Smlib.Part {
  const { altezza, sformo } = misure;
  const dritto = schizzo.extrude(altezza);
  if (sformo <= 0) {
    return dritto;
  }
  const fianchi = dritto.faces().filter((faccia) => Math.abs(faccia.normalAt(faccia.interiorPoint()).z) < 0.5);
  const piano = lib.Plane.XY.offset(schizzo.plane.origin.z);
  try {
    return dritto.draft(fianchi, sformo, altezza > 0 ? piano : piano.flipped());
  } catch {
    return schizzo.extrude(altezza, { taper: sformo });
  }
}
