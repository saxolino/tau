// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scatole } from '#lib/foto-campione/cubo.fixture.js';
import { stessaForma, stessoContenutoInviato } from '#lib/foto-campione/confronto.js';
import { motivoFotoSpenta, schermoComeInviata } from '#lib/foto-campione/pulsante.js';
import type { StatoPulsanteFoto } from '#lib/foto-campione/pulsante.js';

/** Everything ready for a photo: signed in, linked, a version sent and read, a model on screen, a price. */
const pronto: StatoPulsanteFoto = {
  isTrial: false,
  isSignedIn: true,
  isLinked: true,
  versione: 'pronta',
  isBuilding: false,
  hasModel: true,
  hasSentMesh: true,
  schermoUguale: true,
  isPriceLoading: false,
  hasPrice: true,
  isReady: false,
};
const chiaveInviata = 'a'.repeat(64);
/** The version sent on 27 ott, as its GLB came out of the engine of that day. */
const inviata = scatole({ min: [-19, -16, -1.5], max: [19, 16, 1.5] });
/**
 * The same frame on screen today, rendered by another tessellation: a shape comparison can see a difference that is not
 * a change (here the depth of a whole face moved, as an older export or another engine can make it).
 */
const schermoRitassellato = scatole({ min: [-19, -16, -1.5], max: [19, 16, 1.62] });
/** «Larghezza» 38 → 40 mm in the Measures. */
const misuraCambiata = scatole({ min: [-20, -16, -1.5], max: [20, 16, 1.5] });

describe('«Genera foto» against the version sent to Sinopia (difetto 31)', () => {
  it('stays on for a model only opened, even when the shapes disagree', () => {
    expect(stessaForma(inviata, schermoRitassellato).stessa).toBe(false);
    const contenuto = stessoContenutoInviato({ contentKey: chiaveInviata }, { pulito: true, chiave: chiaveInviata });
    const schermoUguale = schermoComeInviata(contenuto, stessaForma(inviata, schermoRitassellato).stessa);
    expect(schermoUguale).toBe(true);
    expect(motivoFotoSpenta({ ...pronto, schermoUguale })).toBeUndefined();
  });

  it('stays on for a version sent from this computer before versions carried their content, with nothing made since', () => {
    const contenuto = stessoContenutoInviato(
      { inviataDaQui: Date.parse('2026-10-27T17:00:00Z') },
      { pulito: true, creataAlle: Date.parse('2026-10-27T16:58:00Z') },
    );
    expect(motivoFotoSpenta({ ...pronto, schermoUguale: schermoComeInviata(contenuto, false) })).toBeUndefined();
  });

  it('turns off with its sentence when a measure changed', () => {
    const forma = stessaForma(inviata, misuraCambiata).stessa;
    expect(forma).toBe(false);
    // The changed measure is a new revision: its content is not the sent one, and the shape says the rest.
    const contenuto = stessoContenutoInviato({ contentKey: chiaveInviata }, { pulito: true, chiave: 'b'.repeat(64) });
    const schermoUguale = schermoComeInviata(contenuto, forma);
    expect(motivoFotoSpenta({ ...pronto, schermoUguale })).toBe('fotoCampione.changedSinceDelivery');
  });

  it('lets the shape decide while edits are not in a revision, or after a revision made since an older send', () => {
    expect(stessoContenutoInviato({ contentKey: chiaveInviata }, { pulito: false, chiave: chiaveInviata })).toBe(
      undefined,
    );
    expect(
      stessoContenutoInviato(
        { inviataDaQui: Date.parse('2026-10-27T17:00:00Z') },
        { pulito: true, creataAlle: Date.parse('2026-10-28T09:00:00Z') },
      ),
    ).toBeUndefined();
    // A version sent from another computer, with no content key: this one cannot vouch for it.
    expect(stessoContenutoInviato({}, { pulito: true, creataAlle: 0 })).toBeUndefined();
    expect(motivoFotoSpenta({ ...pronto, schermoUguale: schermoComeInviata(undefined, true) })).toBeUndefined();
  });

  it('keeps the other reasons in their order', () => {
    expect(motivoFotoSpenta({ ...pronto, isSignedIn: false })).toBe('fotoCampione.signedOut');
    expect(motivoFotoSpenta({ ...pronto, versione: 'nessuna' })).toBe('fotoCampione.notDelivered');
    expect(motivoFotoSpenta({ ...pronto, hasModel: false, isBuilding: true })).toBe('fotoCampione.modelBuilding');
    expect(motivoFotoSpenta({ ...pronto, hasPrice: false })).toBe('fotoCampione.priceMissing');
    expect(motivoFotoSpenta({ ...pronto, isReady: true })).toBe('fotoCampione.alreadyReady');
  });
});
