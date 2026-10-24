import { defineMessages } from '#i18n/define-messages.js';

/** SinopiaCAD's optional tools (Impostazioni › Strumenti): Tau functions a designer can switch on, named for designers. */
export const toolsMessages = defineMessages({
  it: {
    title: 'Strumenti',
    intro:
      'Scegli cosa vedere oltre a Misure e Versioni. Quelli accesi compaiono nella barra a sinistra o con «+» accanto alle Misure.',
    sidebarGroup: 'Strumenti',
    addPanel: 'Aggiungi un pannello',
    choose: 'Scegli gli strumenti…',
    noPanels: 'Nessun pannello acceso',
    pageGroup: 'Nella barra a sinistra',
    panelGroup: 'Accanto alle Misure',
    convert: {
      label: 'Converti un file',
      description: 'Da un formato all’altro sul tuo computer: STEP, STL, OBJ, 3DM di Rhino e altri.',
    },
    import: {
      label: 'Importa un file',
      description: 'Apri un modello che hai già, dal computer.',
    },
    pieces: {
      label: 'Pezzi',
      description: 'L’albero dei pezzi del modello, con nomi, gruppi e visibilità.',
    },
    kinematics: {
      label: 'Movimento',
      description: 'Prova come si muovono cerniere, snodi e chiusure.',
    },
    print: {
      label: 'Stampa 3D',
      description: 'Prepara la cera per la tua stampante 3D.',
    },
    details: {
      label: 'Dettagli',
      description: 'Dimensioni, volume e informazioni del modello.',
    },
    code: {
      label: 'Codice del modello',
      description: 'Per chi scrive il modello a mano: i file sorgente del progetto.',
    },
  },
  en: {
    title: 'Tools',
    intro:
      'Choose what to show besides Measures and Versions. Tools that are on appear in the left bar or under «+» next to Measures.',
    sidebarGroup: 'Tools',
    addPanel: 'Add a panel',
    choose: 'Choose tools…',
    noPanels: 'No panel is on',
    pageGroup: 'In the left bar',
    panelGroup: 'Next to Measures',
    convert: {
      label: 'Convert a file',
      description: 'From one format to another on your computer: STEP, STL, OBJ, Rhino 3DM and more.',
    },
    import: {
      label: 'Import a file',
      description: 'Open a model you already have, from your computer.',
    },
    pieces: {
      label: 'Pieces',
      description: 'The model’s piece tree, with names, groups and visibility.',
    },
    kinematics: {
      label: 'Motion',
      description: 'Try how hinges, joints and clasps move.',
    },
    print: {
      label: '3D printing',
      description: 'Prepare the wax for your 3D printer.',
    },
    details: {
      label: 'Details',
      description: 'The model’s size, volume and information.',
    },
    code: {
      label: 'Model code',
      description: 'For those who write the model by hand: the project’s source files.',
    },
  },
});
