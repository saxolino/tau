import type { SchedaParte } from '#riconoscimento/scheda-parte.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

/**
 * Una risposta REGISTRATA del classificatore, per le prove senza chiamate a pagamento (test, prova a vista in
 * sviluppo): una fibbia rettangolare in ottone vista di fronte, con la luce dichiarata dal catalogo fornitori.
 * Nessun dato di utenti reali: progetto, immagine e impronta sono inventati.
 */

/** La scheda della parte della prova registrata. @public */
export const schedaParteDiProva: SchedaParte = {
  versione: 1,
  progetto: { id: '0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f', verticale: 'footwear' },
  immagine: {
    bucket: 'creator-private',
    path: 'projects/0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f/prova-fibbia.png',
    sha256: '5d0c3c1f4b6e8a2d9f7b1e3c5a7d9f2b4e6a8c0d2f4b6e8a0c2e4f6a8b0d2e4f',
    larghezzaPx: 1024,
    altezzaPx: 1024,
  },
  parte: {
    id: 'fibbia',
    nome: 'Fibbia',
    etichetta: 'Fibbia del cinturino',
    materiale: 'ottone',
    colore: 'oro antico',
    box: [270, 300, 730, 700],
  },
  maschera: {
    bucket: 'creator-private',
    path: 'users/00000000-0000-4000-8000-000000000000/maschere-parti/5d0c3c1f4b6e8a2d9f7b1e3c5a7d9f2b4e6a8c0d2f4b6e8a0c2e4f6a8b0d2e4f/riconosciute/fibbia.270-300-730-700.sam.png',
    origine: 'sam',
  },
  tipo: { partType: 'buckle', fonte: 'catalogo' },
  scala: { tipo: 'catalogo', valoreMm: 20, cosa: 'inner_width_mm', pxPerMm: 11.2, confidenza: 0.9 },
  altreParti: [
    { id: 'cinturino', etichetta: 'Cinturino', box: [80, 380, 920, 620] },
    { id: 'tomaia', etichetta: 'Tomaia', box: [40, 120, 960, 980] },
  ],
};

/** La scheda di riconoscimento registrata (già normalizzata come la restituisce la funzione). @public */
export const schedaRiconoscimentoDiProva: SchedaRiconoscimento = {
  famiglia: { id: 'fibbia', confidenza: 0.93, alternative: [{ id: 'placca', confidenza: 0.04 }] },
  variante: { id: 'rettangolare', confidenza: 0.86 },
  vista: {
    nome: 'fronte',
    faccia: 'sopra',
    azimuth: 4,
    elevation: 8,
    rollo: -2,
    ortografica: false,
    confidenza: 0.78,
    latiOcclusi: [],
  },
  scala: {
    pxPerMm: 11.2,
    fonte: 'catalogo',
    riferimento: 'Luce interna 20 mm dal catalogo fornitori',
    confidenza: 0.9,
  },
  parametri: [
    {
      chiave: 'cinturino.larghezza',
      valore: 19,
      min: 18,
      max: 21,
      confidenza: 0.52,
      fonte: 'proporzione',
      motivo: 'Il cinturino è in parte coperto dal telaio: larghezza letta sul tratto visibile.',
    },
    {
      chiave: 'telaio.altezzaInterna',
      valore: 14,
      min: 12,
      max: 16,
      confidenza: 0.72,
      fonte: 'proporzione',
      motivo: 'Apertura misurata sulla maschera, prospettiva leggera dall’alto.',
    },
    {
      chiave: 'telaio.sezioneLarghezza',
      valore: 3.4,
      min: 3,
      max: 4,
      confidenza: 0.81,
      fonte: 'catalogo',
      motivo: 'Sezione in scala con la luce dichiarata dal catalogo.',
    },
    {
      chiave: 'telaio.raggioAngoli',
      valore: 2.5,
      min: 1.5,
      max: 3.5,
      confidenza: 0.64,
      fonte: 'proporzione',
      motivo: 'Angoli interni poco arrotondati.',
    },
    {
      chiave: 'telaio.sezioneSpessore',
      valore: 2.5,
      confidenza: 0.35,
      fonte: 'non_visibile',
      motivo: 'Lo spessore non si vede in una vista di fronte.',
    },
    {
      chiave: 'telaio.profilo',
      valore: 'bombato',
      confidenza: 0.7,
      fonte: 'proporzione',
      motivo: 'Riflessi arrotondati sul telaio.',
    },
    {
      chiave: 'ardiglione.diametro',
      valore: 2.2,
      min: 1.8,
      max: 2.6,
      confidenza: 0.58,
      fonte: 'proporzione',
      motivo: 'Filo sottile rispetto alla sezione.',
    },
  ],
  materiale: { chiave: 'ottone', confidenza: 0.74 },
  domande: [
    {
      chiave: 'cinturino.larghezza',
      motivo: 'Il cinturino è in parte coperto: quanto è largo?',
      proposte: [18, 19, 20],
    },
  ],
  note: 'Fibbia rettangolare a un ardiglione; spessore del telaio da confermare con una foto di fianco.',
};
