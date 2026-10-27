/**
 * Pianta canonica da una forma demo (T-D1-06 di SinopiaCAD): legge il GLB di una forma (mm, Z in alto, lunghezza
 * lungo X con il tallone a X minima), misura la semilarghezza della zona d'appoggio (vertici entro 3 mm dal fondo
 * della fetta) a 11 stazioni lungo la lunghezza e stampa i 24 punti normalizzati della pianta: tallone, 11 sul
 * fianco +X, punta, 11 sul fianco −X; x e y divisi per la lunghezza, y = 0 al tallone e 1 alla punta.
 *
 *     node scripts/src/pianta-da-forma.ts <forma.glb>
 */
import { NodeIO } from '@gltf-transform/core';

type Punto = readonly [number, number, number];

/** Stazioni lungo la lunghezza (0 tallone, 1 punta) dove si misura la semilarghezza. */
export const stazioniPianta = [0.015, 0.05, 0.1, 0.18, 0.28, 0.4, 0.52, 0.64, 0.74, 0.84, 0.93] as const;

/**
 * I punti della forma in coordinate mondo.
 * @param percorso - File GLB.
 * @returns I vertici.
 */
async function puntiDaGlb(percorso: string): Promise<Punto[]> {
  const documento = await new NodeIO().read(percorso);
  const punti: Punto[] = [];
  for (const nodo of documento.getRoot().listNodes()) {
    const maglia = nodo.getMesh();
    if (!maglia) {
      continue;
    }
    const m = nodo.getWorldMatrix();
    for (const primitiva of maglia.listPrimitives()) {
      const posizioni = primitiva.getAttribute('POSITION');
      const v: number[] = [0, 0, 0];
      for (let indice = 0; indice < (posizioni?.getCount() ?? 0); indice++) {
        posizioni!.getElement(indice, v);
        const [x, y, z] = v as [number, number, number];
        punti.push([
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
      }
    }
  }
  return punti;
}

/**
 * La pianta normalizzata (24 punti) dai vertici di una forma.
 * @param punti - Vertici in mm, lunghezza lungo X dal tallone.
 * @returns I punti `[x, y]` normalizzati per la lunghezza e la lunghezza in mm.
 */
export function piantaDaVertici(punti: readonly Punto[]): { punti: [number, number][]; lunghezza: number } {
  const xs = punti.map(([x]) => x);
  const inizio = Math.min(...xs);
  const lunghezza = Math.max(...xs) - inizio;
  const semilarghezza = (t: number): number => {
    const centro = inizio + t * lunghezza;
    const fetta = punti.filter(([x]) => Math.abs(x - centro) <= 0.03 * lunghezza);
    const fondo = Math.min(...fetta.map(([, , z]) => z));
    return Math.max(...fetta.filter(([, , z]) => z <= fondo + 3).map(([, y]) => Math.abs(y)));
  };
  const lato = stazioniPianta.map((t) => [semilarghezza(t) / lunghezza, t] as [number, number]);
  return {
    punti: [[0, 0], ...lato, [0, 1], ...lato.toReversed().map(([x, y]) => [-x, y] as [number, number])],
    lunghezza,
  };
}

const percorso = process.argv[2];
if (percorso) {
  const { punti, lunghezza } = piantaDaVertici(await puntiDaGlb(percorso));
  process.stdout.write(
    `${JSON.stringify({ lunghezza, punti: punti.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]) })}\n`,
  );
}
