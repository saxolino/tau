import { schedaParteDiProva } from '@taucad/smlib/riconoscimento';
import type { MascheraBinaria } from '@taucad/smlib/riconoscimento';
import type { ParteCaricata } from '#services/sinopia-parts.js';

/**
 * The development trial of «/cad/nuovo» (`?prova=fibbia`, only in a development build): a buckle drawn on a canvas
 * with its mask, and the recorded part sheet. No Sinopia read, no model call. The colours below paint a PICTURE (a
 * stand-in photo), not the interface.
 */

const lato = 1024;
/** The frame's outer and inner rectangles, inside the recorded box [270, 300, 730, 700] (0–1000). */
const esterno = { x: 296, y: 326, w: 444, h: 386, r: 30 };
const sezione = 36;
const ardiglione = { x: 314, y: 506, w: 248, h: 22 };

type Rettangolo = Readonly<{ x: number; y: number; w: number; h: number; r: number }>;

const interno: Rettangolo = {
  x: esterno.x + sezione,
  y: esterno.y + sezione,
  w: esterno.w - 2 * sezione,
  h: esterno.h - 2 * sezione,
  r: 10,
};

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
  const cuoio = context.createLinearGradient(0, 400, 0, 620);
  cuoio.addColorStop(0, '#5a3524');
  cuoio.addColorStop(0.5, '#6f4330');
  cuoio.addColorStop(1, '#4a2b1d');
  context.fillStyle = cuoio;
  context.fillRect(0, 418, lato, 200);
  context.strokeStyle = '#d8c3a5';
  context.setLineDash([10, 9]);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 432);
  context.lineTo(lato, 432);
  context.moveTo(0, 604);
  context.lineTo(lato, 604);
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
  context.fillStyle = ottone;
  context.beginPath();
  context.roundRect(ardiglione.x, ardiglione.y, ardiglione.w, ardiglione.h, 11);
  context.fill();
  context.strokeStyle = 'rgb(255 245 215 / 0.55)';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(esterno.x + 6, esterno.y + 6, esterno.w - 12, esterno.h - 12, 26);
  context.stroke();

  const sagoma = new OffscreenCanvas(lato, lato);
  const contextoSagoma = sagoma.getContext('2d', { willReadFrequently: true })!;
  contextoSagoma.fillStyle = 'black';
  contextoSagoma.fillRect(0, 0, lato, lato);
  contextoSagoma.fillStyle = 'white';
  telaio(contextoSagoma);
  contextoSagoma.fill('evenodd');
  contextoSagoma.beginPath();
  contextoSagoma.roundRect(ardiglione.x, ardiglione.y, ardiglione.w, ardiglione.h, 11);
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
