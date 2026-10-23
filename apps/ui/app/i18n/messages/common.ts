import { defineMessages } from '#i18n/define-messages.js';

/** Words every area uses: the verbs of dialogs and recoveries. */
export const commonMessages = defineMessages({
  it: {
    cancel: 'Annulla',
    close: 'Chiudi',
    retry: 'Riprova',
    save: 'Salva',
    loading: 'Caricamento…',
    pageNotFound: 'Pagina non trovata',
    pageMissing: 'Questa pagina non c’è più. Torna ai tuoi progetti.',
    appError: 'Non riesco ad aprire SinopiaCAD',
    appRecovery: 'Ricarica la pagina. Se il problema continua, riprova tra poco.',
    projects: 'Torna ai progetti',
    reload: 'Ricarica la pagina',
  },
  en: {
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Try again',
    save: 'Save',
    loading: 'Loading…',
    pageNotFound: 'Page not found',
    pageMissing: 'This page is gone. Go back to your projects.',
    appError: 'I can’t open SinopiaCAD',
    appRecovery: 'Reload the page. If the problem continues, try again shortly.',
    projects: 'Back to projects',
    reload: 'Reload the page',
  },
});
