import { describe, expect, it } from 'vitest';
import { senzaVarianti, separaVarianti } from '#lib/assistant-variants-marker.js';

const blocco = [
  '```sinopia-varianti',
  JSON.stringify({
    famiglia: 'fibbia',
    insiemi: [
      { titolo: 'Più leggera', motivo: 'Sezione più sottile.', parametri: { telaio: { sezioneLarghezza: 2.2 } } },
      { titolo: 'Importante', parametri: { telaio: { sezioneLarghezza: 4.5 } } },
    ],
  }),
  '```',
].join('\n');

describe('separaVarianti', () => {
  it('should keep an answer without a block as one text', () => {
    expect(separaVarianti('Ecco la fibbia.')).toEqual([{ tipo: 'testo', testo: 'Ecco la fibbia.' }]);
  });

  it('should take the block out of the prose around it, ready with its sets', () => {
    const parti = separaVarianti(`Tre idee:\n\n${blocco}\n\nScegline una.`);
    expect(parti.map((parte) => parte.tipo)).toEqual(['testo', 'varianti', 'testo']);
    const [, varianti] = parti;
    expect(varianti).toEqual({
      tipo: 'varianti',
      blocco: {
        stato: 'pronto',
        famiglia: 'fibbia',
        insiemi: [
          { titolo: 'Più leggera', motivo: 'Sezione più sottile.', parametri: { telaio: { sezioneLarghezza: 2.2 } } },
          { titolo: 'Importante', parametri: { telaio: { sezioneLarghezza: 4.5 } } },
        ],
      },
    });
  });

  it('should say a block still streaming is in progress, and one that does not read is invalid', () => {
    expect(separaVarianti('Preparo:\n```sinopia-varianti\n{"insiemi": [')).toEqual([
      { tipo: 'testo', testo: 'Preparo:\n' },
      { tipo: 'varianti', blocco: { stato: 'in_corso' } },
    ]);
    expect(separaVarianti('```sinopia-varianti\n{"insiemi": []}\n```')).toEqual([
      { tipo: 'varianti', blocco: { stato: 'non_valido' } },
    ]);
    expect(separaVarianti('```sinopia-varianti\nnon json\n```')).toEqual([
      { tipo: 'varianti', blocco: { stato: 'non_valido' } },
    ]);
  });

  it('should leave other code blocks to the markdown', () => {
    const testo = 'Codice:\n```ts\nconst a = 1;\n```';
    expect(separaVarianti(testo)).toEqual([{ tipo: 'testo', testo }]);
  });
});

describe('senzaVarianti', () => {
  it('should keep the prose for the one-line summary', () => {
    expect(senzaVarianti(`Tre idee:\n${blocco}\nScegline una.`).replaceAll(/\s+/gu, ' ').trim()).toBe(
      'Tre idee: Scegline una.',
    );
  });
});
