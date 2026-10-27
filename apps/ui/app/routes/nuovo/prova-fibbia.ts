import { schedaParteDiProva } from '@taucad/smlib/riconoscimento';
import type { MascheraBinaria } from '@taucad/smlib/riconoscimento';
import type { ParteCaricata } from '#services/sinopia-parts.js';

/**
 * The development trial of «/cad/nuovo» (`?prova=fibbia`, only in a development build): a buckle drawn on a canvas
 * with its mask, and the recorded part sheet. No Sinopia read, no model call. The colours below paint a PICTURE (a
 * stand-in photo), not the interface.
 */

type Rettangolo = Readonly<{ x: number; y: number; w: number; h: number; r: number }>;

const lato = 1024;
/**
 * The buckle of the recorded recognition (`schedaRiconoscimentoDiProva`), drawn at its recorded scale: 11.2 px/mm
 * (inner width 20 mm from the supplier catalogue), the strap horizontal, so the inner width across the strap is
 * vertical. Strap 19 mm and 1 mm of play → 20 mm (224 px) inside across, inner height 14 mm (157 px) along the strap,
 * section 3.4 mm (38 px), inner corners 2.5 mm (28 px), outer corners 2.5 + 3.4 mm (66 px), pin ⌀ 2.2 mm (25 px)
 * from the pin bar over the opposite bar (its tip 9.7 mm from the centre). Until 27 Oct 2026 the drawing was a buckle
 * of other proportions (444 × 386 px, opening wider along the strap than across): no camera and no parameter within
 * the recorded ranges could match it, and the check stayed near IoU 0.1 even from the right view.
 */
const pxPerMm = 11.2;
const mm = (valore: number): number => Math.round(valore * pxPerMm);
const centro = lato / 2;
const sezione = mm(3.4);
const interno: Rettangolo = { x: centro - mm(7), y: centro - mm(10), w: mm(14), h: mm(20), r: mm(2.5) };
const esterno: Rettangolo = {
  x: interno.x - sezione,
  y: interno.y - sezione,
  w: interno.w + 2 * sezione,
  h: interno.h + 2 * sezione,
  r: interno.r + sezione,
};
/** The pin: from the centre of the left bar (the pin bar) to 9.7 mm right of the centre, on the axis. */
const ardiglione = {
  x: centro - mm(7 + 1.7),
  y: centro - mm(1.1),
  w: mm(7 + 1.7) + mm(9.7),
  h: mm(2.2),
};
/** The strap: 19 mm across, through the buckle. */
const cinturino = { y: centro - mm(9.5), h: mm(19) };

/** The frame as one path, outer and inner outline: filled even–odd, the opening stays open. */
const telaio = (context: OffscreenCanvasRenderingContext2D): void => {
  context.beginPath();
  context.roundRect(esterno.x, esterno.y, esterno.w, esterno.h, esterno.r);
  context.roundRect(interno.x, interno.y, interno.w, interno.h, interno.r);
};

/**
 * Draw the trial buckle and its mask.
 *
 * @returns The part as `caricaSchedaParte` returns it.
 */
export async function caricaProvaFibbia(): Promise<ParteCaricata> {
  const foto = new OffscreenCanvas(lato, lato);
  const context = foto.getContext('2d')!;
  const fondo = context.createLinearGradient(0, 0, 0, lato);
  fondo.addColorStop(0, '#ece6dc');
  fondo.addColorStop(1, '#d9d0c2');
  context.fillStyle = fondo;
  context.fillRect(0, 0, lato, lato);
  // The strap, under the frame.
  const cuoio = context.createLinearGradient(0, cinturino.y, 0, cinturino.y + cinturino.h);
  cuoio.addColorStop(0, '#5a3524');
  cuoio.addColorStop(0.5, '#6f4330');
  cuoio.addColorStop(1, '#4a2b1d');
  context.fillStyle = cuoio;
  context.fillRect(0, cinturino.y, lato, cinturino.h);
  context.strokeStyle = '#d8c3a5';
  context.setLineDash([10, 9]);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, cinturino.y + 14);
  context.lineTo(lato, cinturino.y + 14);
  context.moveTo(0, cinturino.y + cinturino.h - 14);
  context.lineTo(lato, cinturino.y + cinturino.h - 14);
  context.stroke();
  context.setLineDash([]);
  // The frame: brass, with a soft shadow.
  const ottone = context.createLinearGradient(esterno.x, esterno.y, esterno.x + esterno.w, esterno.y + esterno.h);
  ottone.addColorStop(0, '#e7c97a');
  ottone.addColorStop(0.45, '#b8913f');
  ottone.addColorStop(1, '#8a6a28');
  context.save();
  context.shadowColor = 'rgb(40 25 10 / 0.35)';
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  context.fillStyle = ottone;
  telaio(context);
  context.fill('evenodd');
  context.restore();
  // The pin is steel (the recorded `ardiglione.materiale`), so it reads as a pin and not as a centre bar.
  const acciaio = context.createLinearGradient(0, ardiglione.y, 0, ardiglione.y + ardiglione.h);
  acciaio.addColorStop(0, '#e3e6ea');
  acciaio.addColorStop(1, '#7d848c');
  context.fillStyle = acciaio;
  context.beginPath();
  context.roundRect(ardiglione.x, ardiglione.y, ardiglione.w, ardiglione.h, ardiglione.h / 2);
  context.fill();
  context.strokeStyle = 'rgb(255 245 215 / 0.55)';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(esterno.x + 6, esterno.y + 6, esterno.w - 12, esterno.h - 12, esterno.r - 6);
  context.stroke();

  const sagoma = new OffscreenCanvas(lato, lato);
  const contextoSagoma = sagoma.getContext('2d', { willReadFrequently: true })!;
  contextoSagoma.fillStyle = 'black';
  contextoSagoma.fillRect(0, 0, lato, lato);
  contextoSagoma.fillStyle = 'white';
  telaio(contextoSagoma);
  contextoSagoma.fill('evenodd');
  contextoSagoma.beginPath();
  contextoSagoma.roundRect(ardiglione.x, ardiglione.y, ardiglione.w, ardiglione.h, ardiglione.h / 2);
  contextoSagoma.fill();
  const { data } = contextoSagoma.getImageData(0, 0, lato, lato);
  const dati = new Uint8Array(lato * lato);
  for (let indice = 0; indice < dati.length; indice++) {
    dati[indice] = data[indice * 4]! > 127 ? 1 : 0;
  }
  const maschera: MascheraBinaria = { larghezza: lato, altezza: lato, dati };
  return {
    schedaParte: structuredClone(schedaParteDiProva),
    immagine: await foto.convertToBlob({ type: 'image/png' }),
    maschera,
    mascheraPng: await sagoma.convertToBlob({ type: 'image/png' }),
  };
}
