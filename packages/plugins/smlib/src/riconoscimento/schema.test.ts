// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applicaLimiti, convalidaStruttura, normalizzaUscita, risolviFamiglia } from '#riconoscimento/condiviso.js';
import { generaContratto } from '#riconoscimento/contratto.js';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
import { schedaParteSchema } from '#riconoscimento/scheda-parte.js';
import { schedaRiconoscimentoSchema } from '#riconoscimento/schema.js';

const contratto = generaContratto();

describe('scheda di riconoscimento: zod e schema JSON gemello', () => {
  it('should accept the recorded answer with both validators and need no correction', () => {
    expect(schedaRiconoscimentoSchema.safeParse(schedaRiconoscimentoDiProva).success).toBe(true);
    expect(convalidaStruttura(schedaRiconoscimentoDiProva, contratto.schemaUscita)).toStrictEqual([]);
    expect(applicaLimiti(schedaRiconoscimentoDiProva, contratto.limitiUscita, true).correzioni).toStrictEqual([]);
  });

  it('should refuse an unknown family, a missing field and an extra field in both validators', () => {
    const famigliaIgnota = {
      ...schedaRiconoscimentoDiProva,
      famiglia: { ...schedaRiconoscimentoDiProva.famiglia, id: 'scarpa' },
    };
    const { note: _note, ...senzaNote } = schedaRiconoscimentoDiProva;
    const conExtra = { ...schedaRiconoscimentoDiProva, extra: 1 };
    const facciaIgnota = {
      ...schedaRiconoscimentoDiProva,
      vista: { ...schedaRiconoscimentoDiProva.vista, faccia: 'lato_b' },
    };
    const { faccia: _faccia, ...vistaSenzaFaccia } = schedaRiconoscimentoDiProva.vista;
    const senzaFaccia = { ...schedaRiconoscimentoDiProva, vista: vistaSenzaFaccia };
    for (const sbagliata of [famigliaIgnota, senzaNote, conExtra, facciaIgnota, senzaFaccia]) {
      expect(schedaRiconoscimentoSchema.safeParse(sbagliata).success).toBe(false);
      expect(convalidaStruttura(sbagliata, contratto.schemaUscita).length).toBeGreaterThan(0);
    }
    expect(convalidaStruttura(senzaNote, contratto.schemaUscita)).toContain('/note: mancante');
    expect(convalidaStruttura(senzaFaccia, contratto.schemaUscita)).toContain('/vista/faccia: mancante');
    expect(convalidaStruttura(conExtra, contratto.schemaUscita)).toContain('/extra: campo non previsto');
  });

  it('should bring the model output back within the limits the API cannot impose, then pass zod', () => {
    const fuori = structuredClone(schedaRiconoscimentoDiProva);
    fuori.famiglia.confidenza = 1.4;
    fuori.vista.azimuth = 200;
    fuori.parametri[0]!.motivo = 'x'.repeat(200);
    fuori.famiglia.alternative = [
      { id: 'placca', confidenza: 0.1 },
      { id: 'borchia', confidenza: 0.05 },
      { id: 'anello', confidenza: 0.01 },
    ];
    fuori.scala.pxPerMm = 0;
    const { valore, correzioni, errori } = applicaLimiti(fuori, contratto.limitiUscita, true);
    expect(errori).toStrictEqual([]);
    expect(correzioni).toEqual(
      expect.arrayContaining([
        '/famiglia/confidenza',
        '/vista/azimuth',
        '/parametri/0/motivo',
        '/famiglia/alternative',
        '/scala/pxPerMm',
      ]),
    );
    expect(valore.famiglia.confidenza).toBe(1);
    expect(valore.scala.pxPerMm).toBeNull();
    expect(valore.parametri[0]!.motivo).toHaveLength(140);
    expect(schedaRiconoscimentoSchema.safeParse(valore).success).toBe(true);
    expect(fuori.famiglia.confidenza).toBe(1.4);
  });

  it('should refuse a three-proposal question with two proposals even when correcting', () => {
    const corta = structuredClone(schedaRiconoscimentoDiProva);
    corta.domande[0]!.proposte = [18, 19];
    expect(applicaLimiti(corta, contratto.limitiUscita, true).errori).toStrictEqual([
      '/domande/0/proposte: troppo pochi elementi',
    ]);
  });
});

describe('scheda della parte', () => {
  it('should accept the recorded part with zod and with the contract, strictly', () => {
    expect(schedaParteSchema.safeParse(schedaParteDiProva).success).toBe(true);
    expect(convalidaStruttura(schedaParteDiProva, contratto.schemaParte)).toStrictEqual([]);
    expect(applicaLimiti(schedaParteDiProva, contratto.limitiParte, false).errori).toStrictEqual([]);
  });

  it('should refuse a bad fingerprint, a public bucket and an empty path', () => {
    const impronta = { ...schedaParteDiProva, immagine: { ...schedaParteDiProva.immagine, sha256: 'ABC' } };
    const pubblico = { ...schedaParteDiProva, immagine: { ...schedaParteDiProva.immagine, bucket: 'assets' } };
    const vuoto = { ...schedaParteDiProva, immagine: { ...schedaParteDiProva.immagine, path: '' } };
    expect(schedaParteSchema.safeParse(impronta).success).toBe(false);
    expect(convalidaStruttura(impronta, contratto.schemaParte)).toStrictEqual(['/immagine/sha256: formato non valido']);
    expect(convalidaStruttura(pubblico, contratto.schemaParte)).toStrictEqual([
      '/immagine/bucket: atteso "creator-private"',
    ]);
    expect(applicaLimiti(vuoto, contratto.limitiParte, false).errori).toStrictEqual(['/immagine/path: troppo corto']);
  });
});

describe('normalizzazione sul catalogo', () => {
  it('should drop unknown and derived keys, clamp out-of-range values and cap hidden ones', () => {
    const uscita = structuredClone(schedaRiconoscimentoDiProva);
    uscita.parametri.push(
      { chiave: 'telaio.inventato', valore: 3, confidenza: 0.9, fonte: 'proporzione', motivo: '' },
      { chiave: 'telaio.luce', valore: 21, confidenza: 0.9, fonte: 'proporzione', motivo: '' },
      { chiave: 'ardiglione.gioco', valore: 9, confidenza: 0.9, fonte: 'proporzione', motivo: '' },
      { chiave: 'telaio.profilo', valore: 'stellato', confidenza: 0.9, fonte: 'proporzione', motivo: '' },
    );
    uscita.parametri[4]!.confidenza = 0.9;
    uscita.domande.push({ chiave: 'telaio.inventato', motivo: '', proposte: [1, 2, 3] });
    const { uscita: normale, scartati, corretti } = normalizzaUscita(uscita, contratto.famiglie);
    expect(scartati).toStrictEqual(['telaio.inventato', 'telaio.luce', 'telaio.profilo', 'domanda:telaio.inventato']);
    expect(corretti).toStrictEqual(['ardiglione.gioco']);
    expect(normale.parametri.find((p) => p.chiave === 'ardiglione.gioco')).toMatchObject({
      valore: 0.6,
      fonte: 'default_mestiere',
      confidenza: 0.3,
    });
    expect(normale.parametri.find((p) => p.chiave === 'telaio.sezioneSpessore')!.confidenza).toBe(0.4);
  });

  it('should replace an unknown variant with the first one and empty a family without recipe', () => {
    const variante = { ...schedaRiconoscimentoDiProva, variante: { id: 'stellata', confidenza: 0.9 } };
    expect(normalizzaUscita(variante, contratto.famiglie).uscita.variante).toStrictEqual({
      id: 'rettangolare',
      confidenza: 0.3,
    });
    const libero = { ...schedaRiconoscimentoDiProva, famiglia: { id: 'libero', confidenza: 0.8, alternative: [] } };
    const { uscita } = normalizzaUscita(libero, contratto.famiglie);
    expect(uscita.parametri).toStrictEqual([]);
    expect(uscita.domande).toStrictEqual([]);
  });

  it('should bind the family for user, library and catalogue sources and only suggest it otherwise', () => {
    expect(risolviFamiglia({ partType: 'buckle', fonte: 'catalogo' }, contratto)).toStrictEqual({
      vincolo: 'vincolata',
      famiglia: 'fibbia',
      variante: 'rettangolare',
    });
    expect(risolviFamiglia({ partType: 'heel', fonte: 'riconosci_parti' }, contratto).vincolo).toBe('suggerita');
    expect(risolviFamiglia({ partType: 'ornament', fonte: 'utente' }, contratto).vincolo).toBe('suggerita');
    expect(risolviFamiglia({ partType: 'closure', fonte: 'libreria' }, contratto).famiglia).toBe('fibbia');
    expect(risolviFamiglia({ partType: 'leather', fonte: 'catalogo' }, contratto)).toStrictEqual({
      vincolo: 'vincolata',
      famiglia: 'non_modellabile',
    });
    expect(risolviFamiglia({ partType: 'other_accessory', fonte: 'catalogo' }, contratto).vincolo).toBe('libera');
    expect(risolviFamiglia({ partType: '__proto__', fonte: 'catalogo' }, contratto).vincolo).toBe('libera');
    expect(risolviFamiglia(undefined, contratto).vincolo).toBe('libera');
  });
});
