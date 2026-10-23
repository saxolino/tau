import { defineMessages } from '#i18n/define-messages.js';

/** The account menu: the account, the theme and the language. */
export const accountMessages = defineMessages({
  it: {
    sinopiaAccount: 'Account Sinopia',
    signOut: 'Esci',
    theme: {
      label: 'Tema',
      choose: 'Scegli il tema',
      light: 'Chiaro',
      black: 'Nero',
      system: 'Sistema',
      lightDescription: 'I colori chiari di Sinopia',
      blackDescription: 'Il carbone caldo di Sinopia',
      systemDescription: 'Segue il tema del sistema',
    },
    language: {
      label: 'Lingua',
      // Each language is named in itself, in both catalogs.
      it: 'Italiano',
      en: 'English',
    },
  },
  en: {
    sinopiaAccount: 'Sinopia account',
    signOut: 'Sign out',
    theme: {
      label: 'Theme',
      choose: 'Choose the theme',
      light: 'Light',
      black: 'Black',
      system: 'System',
      lightDescription: "Sinopia's light colours",
      blackDescription: "Sinopia's warm charcoal",
      systemDescription: 'Follows your system setting',
    },
    language: {
      label: 'Language',
      it: 'Italiano',
      en: 'English',
    },
  },
});
