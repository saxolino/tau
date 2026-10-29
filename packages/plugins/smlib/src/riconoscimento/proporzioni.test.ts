// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { misureDallaFoto, soglieProporzioni, visibilitaParte } from '#riconoscimento/proporzioni.js';
import type { IngressoProporzioni, Riquadro1000 } from '#riconoscimento/proporzioni.js';
import type { MascheraBinaria } from '#riconoscimento/scala.js';

/** Una maschera della misura della foto con un rettangolo acceso (pixel, estremi compresi). */
const maschera = (
  larghezza: number,
  altezza: number,
  rettangolo: Readonly<{ x0: number; y0: number; x1: number; y1: number }>,
): MascheraBinaria => {
  const dati = new Uint8Array(larghezza * altezza);
  for (let y = rettangolo.y0; y <= rettangolo.y1; y++) {
    dati.fill(1, y * larghezza + rettangolo.x0, y * larghezza + rettangolo.x1 + 1);
  }
  return { larghezza, altezza, dati };
};

// Una scarpa di fianco in una foto 1000 × 500: tomaia, suola e tacco. L'unione va da x 100 a 900 e da y 300 a 800
// (in millesimi), cioè 800 × 250 px: lunghezza / altezza = 3,2, una vista di fianco.
const immagine = { larghezzaPx: 1000, altezzaPx: 500 };
const tacco: Riquadro1000 = [700, 500, 800, 800];
const scarpaDiFianco: IngressoProporzioni = {
  verticale: 'footwear',
  immagine,
  riquadro: tacco,
  altreParti: [{ box: [100, 300, 900, 700] }, { box: [100, 700, 900, 800] }],
  // Il tacco nella foto: 100 × 150 px (x 700–799, y 250–399).
  maschera: maschera(1000, 500, { x0: 700, y0: 250, x1: 799, y1: 399 }),
};

describe('proporzioni dalla foto', () => {
  it('should measure the heel against the side view of the shoe with a high reliability', () => {
    const misure = misureDallaFoto(scarpaDiFianco);
    expect(misure.visibilita).toStrictEqual({ stato: 'intera', motivi: [] });
    expect(misure.proporzioni).toStrictEqual({
      rapporti: [
        // 150 px di tacco su 800 px di scarpa, 100 px su 800, 150 px su 250.
        { chiave: 'altezza_su_lunghezza', valore: 0.188 },
        { chiave: 'larghezza_su_lunghezza', valore: 0.125 },
        { chiave: 'altezza_su_altezza', valore: 0.6 },
      ],
      affidabilita: soglieProporzioni.affidabilitaAlta,
      parti: 3,
    });
  });

  it('should give a low reliability to a tight or three-quarter framing', () => {
    // Su una foto 1000 × 1000 la stessa unione è 800 × 500 px: lunghezza / altezza 1,6, non è un fianco.
    const stretta = misureDallaFoto({
      ...scarpaDiFianco,
      immagine: { larghezzaPx: 1000, altezzaPx: 1000 },
      maschera: maschera(1000, 1000, { x0: 700, y0: 500, x1: 799, y1: 799 }),
    });
    expect(stretta.proporzioni?.affidabilita).toBe(soglieProporzioni.affidabilitaBassa);
    expect(stretta.proporzioni?.rapporti.length).toBe(3);
  });

  it('should mark a mask on the picture edge as cut, and lower the reliability', () => {
    const tagliata = misureDallaFoto({
      ...scarpaDiFianco,
      maschera: maschera(1000, 500, { x0: 700, y0: 250, x1: 799, y1: 499 }),
    });
    expect(tagliata.visibilita).toStrictEqual({ stato: 'parziale', motivi: ['tagliata_bordo'] });
    expect(tagliata.proporzioni?.affidabilita).toBe(soglieProporzioni.affidabilitaBassa);
  });

  it('should give a low reliability with fewer than three parts, and no proportions without a product', () => {
    const dueParti = misureDallaFoto({ ...scarpaDiFianco, altreParti: [{ box: [100, 300, 900, 800] }] });
    expect(dueParti.proporzioni?.parti).toBe(2);
    expect(dueParti.proporzioni?.affidabilita).toBe(soglieProporzioni.affidabilitaBassa);
    expect(misureDallaFoto({ ...scarpaDiFianco, altreParti: [] }).proporzioni).toBeUndefined();
  });

  it('should keep the reliability low outside footwear, where no side-view shape is known', () => {
    expect(misureDallaFoto({ ...scarpaDiFianco, verticale: 'leather_goods' }).proporzioni?.affidabilita).toBe(
      soglieProporzioni.affidabilitaBassa,
    );
  });
});

describe('visibilità della parte', () => {
  it('should call a mask under 64 px small', () => {
    const piccola = visibilitaParte({
      ...scarpaDiFianco,
      maschera: maschera(1000, 500, { x0: 400, y0: 200, x1: 440, y1: 260 }),
    });
    expect(piccola).toStrictEqual({ stato: 'parziale', motivi: ['piccola'] });
  });

  it('should read the edge and the size from the box when there is no mask', () => {
    const { maschera: _maschera, ...senzaMaschera } = scarpaDiFianco;
    expect(visibilitaParte(senzaMaschera)).toStrictEqual({ stato: 'intera', motivi: [] });
    expect(visibilitaParte({ ...senzaMaschera, riquadro: [700, 500, 800, 1000] })).toStrictEqual({
      stato: 'parziale',
      motivi: ['tagliata_bordo'],
    });
    expect(visibilitaParte({ ...senzaMaschera, riquadro: [500, 500, 520, 560] })).toStrictEqual({
      stato: 'parziale',
      motivi: ['piccola'],
    });
  });
});
