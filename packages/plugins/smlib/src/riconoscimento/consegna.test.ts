// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { catalogoFamiglie } from '#riconoscimento/contratto.js';
import { schedaConsegnata } from '#riconoscimento/consegna.js';
import { pianoCostruzione } from '#riconoscimento/costruisci.js';
import { schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
import { schedaRiconoscimentoSchema } from '#riconoscimento/schema.js';
import { statoValore } from '#riconoscimento/soglie.js';
import { consegnaVerifica } from '#verifica/pipeline.js';

const catalogo = catalogoFamiglie().find((famiglia) => famiglia.id === 'fibbia')!;

describe('la scheda dopo la verifica', () => {
  const consegna = consegnaVerifica(
    schedaRiconoscimentoDiProva,
    {
      famiglia: 'fibbia',
      variante: 'rettangolare',
      iou: 0.94,
      chiaviOttimizzate: ['telaio.altezzaInterna', 'telaio.sezioneSpessore'],
      parametri: { telaio: { altezzaInterna: 14.6, sezioneSpessore: 3.1 } },
      sensibilita: [
        { chiave: 'telaio.altezzaInterna', sensibilita: 0.2, degrado: 0.08, osservabile: true, banda: [14, 15] },
        { chiave: 'telaio.sezioneSpessore', sensibilita: 0.001, degrado: 0.001, osservabile: false, banda: [2, 6] },
      ],
    },
    'accettato',
  );

  it('should give measured what the view fixes and an assumption with a band what it does not', () => {
    const scheda = schedaConsegnata(schedaRiconoscimentoDiProva, consegna, { lingua: 'it', catalogo });
    expect(schedaRiconoscimentoSchema.safeParse(scheda).success).toBe(true);
    const altezza = scheda.parametri.find((parametro) => parametro.chiave === 'telaio.altezzaInterna')!;
    expect(altezza).toMatchObject({ valore: 14.6, confidenza: 0.9 });
    expect(altezza.motivo).toBe('Misurato sulla silhouette della foto (IoU 0,94).');
    expect(statoValore(altezza)).toBe('misurata');
    const spessore = scheda.parametri.find((parametro) => parametro.chiave === 'telaio.sezioneSpessore')!;
    expect(spessore).toMatchObject({ min: 2, max: 6, fonte: 'non_visibile' });
    expect(statoValore(spessore)).toBe('ipotesi');
    expect(spessore.motivo).toContain('La vista non fissa questa misura');
  });

  it('should write the marker of the assumption only for the parameters the view does not fix', () => {
    const scheda = schedaConsegnata(schedaRiconoscimentoDiProva, consegna, { lingua: 'en', catalogo });
    const piano = pianoCostruzione(scheda)!;
    expect(piano.parametri).toMatchObject({ telaio: { altezzaInterna: 14.6 } });
    expect(piano.ipotesi['telaio.altezzaInterna']).toBeUndefined();
    expect(piano.ipotesi['telaio.sezioneSpessore']).toContain('min=2 max=6');
    expect(scheda.parametri.find((p) => p.chiave === 'telaio.altezzaInterna')!.motivo).toBe(
      "Measured on the photo's silhouette (IoU 0.94).",
    );
  });
});
