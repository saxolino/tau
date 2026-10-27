import { describe, expect, it } from 'vitest';
import type { Esito } from '@taucad/smlib/famiglie';
import { controlliDaProducibilita } from '#lib/scheda-controlli.js';

const esito = (livello: Esito['livello'], codice: string, extra: Partial<Esito> = {}): Esito => ({
  livello,
  codice,
  messaggio: `${codice} ${livello}`,
  ...extra,
});

describe('controlliDaProducibilita', () => {
  it('should follow the state of the shared checks: running, failed, unavailable', () => {
    expect(controlliDaProducibilita({ stato: 'inattivo', controlli: [], aggiornati: false }, 'it')).toEqual({
      stato: 'caricamento',
    });
    expect(controlliDaProducibilita({ stato: 'in_corso', controlli: [], aggiornati: false }, 'it')).toEqual({
      stato: 'caricamento',
    });
    // Measured, but a newer render waits for its measure: the card does not show the old verdict as current.
    expect(controlliDaProducibilita({ stato: 'pronto', controlli: [], aggiornati: false }, 'it')).toEqual({
      stato: 'caricamento',
    });
    expect(controlliDaProducibilita({ stato: 'errore', controlli: [], aggiornati: false }, 'it')).toEqual({
      stato: 'errore',
    });
    expect(
      controlliDaProducibilita({ stato: 'non_disponibile', controlli: [], aggiornati: false }, 'it'),
    ).toBeUndefined();
  });

  it('should list warnings and blocks only, blocks first, worded like the inspector’s checks', () => {
    const risultato = controlliDaProducibilita(
      {
        stato: 'pronto',
        aggiornati: true,
        controlli: [
          esito('ok', 'SOLIDO_CHIUSO'),
          esito('avviso', 'PARETE_MIN', { pezzo: 'Telaio', valore: 1.1, soglia: 1.2 }),
          esito('info', 'PESO', { pezzo: 'Telaio', valore: 4.5 }),
          esito('blocco', 'TRATTO_MIN', { pezzo: 'Placca' }),
        ],
      },
      'it',
    );
    expect(risultato).toMatchObject({ stato: 'pronto' });
    const righe = risultato?.stato === 'pronto' ? risultato.righe : [];
    expect(righe.map(({ livello }) => livello)).toEqual(['blocco', 'avviso']);
    expect(righe[1]).toMatchObject({ testo: 'Telaio: parete 1,1 mm, minimo 1,2 mm', pezzo: 'Telaio' });
  });

  it('should be empty when nothing is to be looked at', () => {
    expect(
      controlliDaProducibilita({ stato: 'pronto', aggiornati: true, controlli: [esito('ok', 'SOLIDO_CHIUSO')] }, 'it'),
    ).toEqual({ stato: 'pronto', righe: [] });
  });
});
