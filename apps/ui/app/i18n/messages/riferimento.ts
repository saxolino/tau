import { defineMessages } from '#i18n/define-messages.js';

/** L'immagine da cui nasce il modello, nel riquadro 3D: il pulsante nella barra e il pannello accanto al modello. */
export const riferimentoMessages = defineMessages({
  it: {
    name: 'Riferimento',
    show: 'Mostra il riferimento',
    hide: 'Nascondi il riferimento',
    close: 'Chiudi il riferimento',
    enlarge: 'Ingrandisci',
    reduce: 'Riduci',
    previous: 'Riferimento precedente',
    next: 'Riferimento successivo',
    position: '{current} / {total}',
    origins: {
      foto: 'Da foto',
      sinopia: 'Da Sinopia',
      caricata: 'Immagine caricata',
    },
    loading: 'Carico l’immagine…',
    unavailable: 'Non riesco a leggere questa immagine.',
  },
  en: {
    name: 'Reference',
    show: 'Show the reference',
    hide: 'Hide the reference',
    close: 'Close the reference',
    enlarge: 'Enlarge',
    reduce: 'Reduce',
    previous: 'Previous reference',
    next: 'Next reference',
    position: '{current} / {total}',
    origins: {
      foto: 'From photo',
      sinopia: 'From Sinopia',
      caricata: 'Uploaded image',
    },
    loading: 'Loading the image…',
    unavailable: 'I can’t read this image.',
  },
});
