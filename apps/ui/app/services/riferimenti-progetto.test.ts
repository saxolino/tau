import { describe, expect, it, vi } from 'vitest';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import { leggiRiferimentiProgetto, riferimentiDaAllegati, riferimentiDaFile } from '#services/riferimenti-progetto.js';
import type { FileRiferimenti } from '#services/riferimenti-progetto.js';

const radice = '/projects/proj_1';

/** Un disco del progetto in memoria: percorsi assoluti → byte; le cartelle sono i prefissi. */
const disco = (file: Readonly<Record<string, Uint8Array<ArrayBuffer>>>): FileRiferimenti => ({
  exists: async (path) => path in file || Object.keys(file).some((chiave) => chiave.startsWith(`${path}/`)),
  readdir: async (path) => [
    ...new Set(
      Object.keys(file)
        .filter((chiave) => chiave.startsWith(`${path}/`))
        .map((chiave) => chiave.slice(path.length + 1).split('/')[0]!),
    ),
  ],
  readFile: async (path) => {
    const bytes = file[path];
    if (!bytes) {
      throw new Error(`ENOENT: ${path}`);
    }
    return bytes;
  },
});

const testo = (valore: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(valore);

describe('riferimentiDaFile', () => {
  it('should list the pictures only, the recognised photo first with its part and mask', () => {
    const riferimenti = riferimentiDaFile(
      ['schizzo.jpg', 'misure.json', 'tacco.maschera.png', 'sinopia-3f2a9c1e.jpg', 'tacco.png', 'note.txt'],
      { parte: { id: 'tacco', etichetta: 'Tacco a spillo' }, nomi: { 'sinopia-3f2a9c1e.jpg': 'Sandalo Fiore' } },
    );

    expect(riferimenti).toEqual([
      {
        percorso: 'riferimenti/tacco.png',
        tipo: 'image/png',
        origine: 'foto',
        dettaglio: 'Tacco a spillo',
        maschera: 'riferimenti/tacco.maschera.png',
      },
      {
        percorso: 'riferimenti/sinopia-3f2a9c1e.jpg',
        tipo: 'image/jpeg',
        origine: 'sinopia',
        dettaglio: 'Sandalo Fiore',
      },
      { percorso: 'riferimenti/schizzo.jpg', tipo: 'image/jpeg', origine: 'caricata' },
    ]);
  });

  it('should still recognise a photo by its mask when the recognition record is not on this device', () => {
    expect(riferimentiDaFile(['tacco.maschera.png', 'tacco.jpg'])).toEqual([
      {
        percorso: 'riferimenti/tacco.jpg',
        tipo: 'image/jpeg',
        origine: 'foto',
        maschera: 'riferimenti/tacco.maschera.png',
      },
    ]);
  });

  it('should return nothing for a folder without pictures', () => {
    expect(riferimentiDaFile(['misure.json', 'parte.maschera.png'])).toEqual([]);
  });
});

describe('leggiRiferimentiProgetto', () => {
  it('should read the photo of a project built by the recognition, with the part it shows', async () => {
    const progetto = progettoRiconosciuto({
      scheda: schedaRiconoscimentoDiProva,
      schedaParte: schedaParteDiProva,
      immagine: { bytes: new Uint8Array([1, 2, 3]), tipo: 'image/png' },
      maschera: new Uint8Array([4]),
      lingua: 'it',
    })!;
    const file = Object.fromEntries(
      Object.entries(progetto.files).map(([percorso, { content }]) => [`${radice}/${percorso}`, content]),
    );

    const letti = await leggiRiferimentiProgetto(disco(file), radice);

    expect(letti).toEqual({
      riferimenti: [
        {
          percorso: 'riferimenti/fibbia.png',
          tipo: 'image/png',
          origine: 'foto',
          dettaglio: 'Fibbia del cinturino',
          maschera: 'riferimenti/fibbia.maschera.png',
        },
      ],
    });
  });

  it('should name the library piece and the Sinopia project of the model', async () => {
    const link = {
      modelId: '4c1f1b8e-2f8a-4d6b-9a51-0d3f3c2b1a10',
      projectId: '0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f',
      userId: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
      baseRevisionId: null,
    };
    const letti = await leggiRiferimentiProgetto(
      disco({
        [`${radice}/riferimenti/sinopia-3f2a9c1e.jpg`]: new Uint8Array([1]),
        [`${radice}/riferimenti/misure.json`]: testo(
          JSON.stringify([{ filename: 'sinopia-3f2a9c1e.jpg', name: 'Sandalo Fiore', widthMm: null }]),
        ),
        [`${radice}/.tau/sinopia.json`]: testo(JSON.stringify(link)),
      }),
      radice,
    );

    expect(letti).toEqual({
      riferimenti: [
        {
          percorso: 'riferimenti/sinopia-3f2a9c1e.jpg',
          tipo: 'image/jpeg',
          origine: 'sinopia',
          dettaglio: 'Sandalo Fiore',
        },
      ],
      progettoSinopia: { id: link.projectId, userId: link.userId },
    });
  });

  it('should keep the pictures when the records beside them cannot be read', async () => {
    const letti = await leggiRiferimentiProgetto(
      disco({
        [`${radice}/riferimenti/foto.webp`]: new Uint8Array([1]),
        [`${radice}/riferimenti/misure.json`]: testo('{non json'),
        [`${radice}/.tau/workbench/riconoscimento.json`]: testo('[]'),
        [`${radice}/.tau/sinopia.json`]: testo('{"modelId":"x"}'),
      }),
      radice,
    );

    expect(letti).toEqual({
      riferimenti: [{ percorso: 'riferimenti/foto.webp', tipo: 'image/webp', origine: 'caricata' }],
    });
  });

  it('should find nothing in a project without references', async () => {
    expect(await leggiRiferimentiProgetto(disco({ [`${radice}/main.ts`]: testo('') }), radice)).toEqual({
      riferimenti: [],
    });
  });
});

describe('riferimentiDaAllegati', () => {
  const hash = (lettera: string): string => lettera.repeat(64);

  it('should copy the uploaded and pasted pictures beside the model, never the documents', async () => {
    const leggi = vi.fn(async () => new Uint8Array([7]));

    const file = await riferimentiDaAllegati(
      [
        { hash: hash('a'), mediaType: 'image/jpeg', filename: 'Tacco Rosso (1).JPG' },
        { hash: hash('b'), mediaType: 'image/png' },
        { hash: hash('c'), mediaType: 'application/pdf', filename: 'scheda.pdf' },
      ],
      leggi,
    );

    expect(Object.keys(file)).toEqual(['riferimenti/tacco-rosso-1.jpg', 'riferimenti/immagine-2.png']);
    expect(file['riferimenti/tacco-rosso-1.jpg']?.content).toEqual(new Uint8Array([7]));
    expect(leggi).toHaveBeenCalledTimes(2);
  });

  it('should leave the Sinopia images already copied and number two pictures with the same name', async () => {
    const file = await riferimentiDaAllegati(
      [
        { hash: hash('a'), mediaType: 'image/jpeg', filename: 'sinopia-3f2a9c1e.jpg' },
        { hash: hash('b'), mediaType: 'image/png', filename: 'foto.png' },
        { hash: hash('c'), mediaType: 'image/png', filename: 'foto.png' },
        { hash: hash('d'), mediaType: 'image/png', filename: 'tacco.maschera.png' },
      ],
      async () => new Uint8Array([1]),
      { 'riferimenti/sinopia-3f2a9c1e.jpg': { content: new Uint8Array([9]) } },
    );

    expect(Object.keys(file)).toEqual([
      'riferimenti/foto.png',
      'riferimenti/foto-2.png',
      'riferimenti/tacco-maschera.png',
    ]);
  });

  it('should skip a picture whose bytes are no longer in the draft', async () => {
    expect(await riferimentiDaAllegati([{ hash: hash('a'), mediaType: 'image/png' }], async () => undefined)).toEqual(
      {},
    );
  });
});
