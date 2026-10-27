import { defineMessages } from '#i18n/define-messages.js';

/** The viewer while the agent builds a model from nothing: its steps, the announced size and the pieces entering. */
export const cantiereMessages = defineMessages({
  it: {
    steps: {
      request: 'Leggo la richiesta',
      image: 'Guardo l’immagine',
      study: 'Studio come costruirlo',
      read: 'Leggo il progetto',
      plan: 'Preparo il piano',
      write: 'Scrivo i pezzi',
      build: 'Costruisco il modello',
      check: 'Controllo il modello',
      views: 'Guardo le viste',
      web: 'Cerco riferimenti',
      question: 'Aspetto la tua risposta',
      think: 'Ragiono sul prossimo passo',
      work: 'Lavoro al modello',
    },
    millimetres: '{value} mm',
  },
  en: {
    steps: {
      request: 'Reading your request',
      image: 'Looking at the image',
      study: 'Working out how to build it',
      read: 'Reading the project',
      plan: 'Planning the pieces',
      write: 'Writing the pieces',
      build: 'Building the model',
      check: 'Checking the model',
      views: 'Checking the views',
      web: 'Looking up references',
      question: 'Waiting for your answer',
      think: 'Working out the next step',
      work: 'Working on the model',
    },
    millimetres: '{value} mm',
  },
});
