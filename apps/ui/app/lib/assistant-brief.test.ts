import { describe, expect, it } from 'vitest';
import type { RJSFSchema } from '@rjsf/utils';
import { anello, emettiMainFamiglia, fibbia } from '@taucad/smlib/famiglie';
import type { Esito } from '@taucad/smlib/famiglie';
import type { GeometryComponentNode } from '@taucad/types';
import {
  chiaviFoglia,
  chipsAssistente,
  famigliaDalMain,
  ingombroModello,
  ipotesiAperte,
  misureChiaveFamiglia,
  parametriEffettivi,
  rigaEsito,
  rigaModifica,
  schedaModello,
} from '#lib/assistant-brief.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const piece = (name: string, extras?: GeometryComponentNode['extras']): GeometryComponentNode => ({
  id: `component:${name}`,
  name,
  kind: 'part',
  extras,
  selector: name,
  childIds: [],
  depth: 1,
  path: [name],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
});
const telaio = piece('Telaio', {
  volumeMm3: 482.7,
  density: 6.7,
  manualBounds: { min: [-13.5, -9, 0], max: [13.5, 9, 2.5] },
});
const ardiglione = piece('Ardiglione', {
  volumeMm3: 161.7,
  density: 7.85,
  manualBounds: { min: [-1.25, -9, -1.2], max: [1.25, 8.5, 4.4] },
});
const fibbiaDiProva = { definizione: fibbia, variante: 'rettangolare', parametri: fibbia.predefiniti('rettangolare') };

describe('famigliaDalMain', () => {
  it('should read the family a recipe project declares, and nothing from a free model', () => {
    const main = emettiMainFamiglia({ id: 'fibbia', versione: 1, variante: 'a_d' }, fibbia.predefiniti('a_d'), {});
    expect(famigliaDalMain(main)).toEqual({ id: 'fibbia', versione: 1, variante: 'a_d' });
    expect(famigliaDalMain('export default function main() { return Box(10, 10, 10); }')).toBeUndefined();
    // A family that does not exist, or a variant the family does not have, is a free model.
    expect(famigliaDalMain("export const famiglia = { id: 'cintura', versione: 1, variante: 'a' };")).toBeUndefined();
    expect(
      famigliaDalMain("export const famiglia = { id: 'fibbia', versione: 1, variante: 'stella' };"),
    ).toBeUndefined();
  });
});

describe('parametriEffettivi and chiaviFoglia', () => {
  it('should lay the designer’s values over the recipe’s defaults, and list them', () => {
    const predefiniti = { telaio: { sezioneLarghezza: 3, profilo: 'bombato' }, cinturino: { larghezza: 20 } };
    const valori = { telaio: { sezioneLarghezza: 2.4 } };
    expect(parametriEffettivi(predefiniti, valori)).toEqual({
      telaio: { sezioneLarghezza: 2.4, profilo: 'bombato' },
      cinturino: { larghezza: 20 },
    });
    // The defaults are not changed in place.
    expect(predefiniti.telaio.sezioneLarghezza).toBe(3);
    expect(chiaviFoglia(valori)).toEqual(['telaio.sezioneLarghezza']);
    expect(chiaviFoglia({})).toEqual([]);
  });
});

describe('ipotesiAperte', () => {
  const schema: RJSFSchema = {
    type: 'object',
    properties: {
      telaio: {
        type: 'object',
        properties: {
          sezioneLarghezza: { type: 'number', description: '[sinopia:assumed c=0.5 f=proporzione] Dalla foto' },
          altezzaInterna: { type: 'number', description: '[sinopia:assumed c=0.95 f=misura] Misurata' },
          raggioAngoli: { type: 'number', description: '[sinopia:assumed] Non visibile' },
        },
      },
    },
  };
  it('should count the assumptions still open, not the measured ones nor those the designer fixed', () => {
    expect(ipotesiAperte(schema, {})).toBe(2);
    expect(ipotesiAperte(schema, { telaio: { raggioAngoli: 2 } })).toBe(1);
    expect(ipotesiAperte(undefined, {})).toBe(0);
  });
});

describe('ingombroModello', () => {
  it('should measure all pieces together', () => {
    const [x, y, z] = ingombroModello([telaio, ardiglione])!;
    expect([x, y, z]).toEqual([27, 18, 5.6000000000000005]);
    expect(ingombroModello([piece('vuoto')])).toBeUndefined();
  });
});

describe('misureChiaveFamiglia', () => {
  it('should give a buckle’s opening, inner length and section, derived ones computed', () => {
    expect(misureChiaveFamiglia(fibbia, fibbia.predefiniti(), 'it')).toEqual([
      { etichetta: 'Luce', valore: '21 mm' },
      { etichetta: 'Apertura', valore: '12 mm' },
      { etichetta: 'Sezione', valore: '3 × 2,5 mm' },
    ]);
  });

  it('should say a ring’s size with its system and inner diameter, the stone as a diameter', () => {
    const [taglia, , pietra] = misureChiaveFamiglia(anello, anello.predefiniti(), 'en');
    expect(taglia).toEqual({ etichetta: 'Size', valore: 'IT 14 · Ø 17.19 mm' });
    expect(pietra).toEqual({ etichetta: 'Stone', valore: 'Ø 5 mm' });
  });
});

describe('rigaEsito and rigaModifica', () => {
  const esito: Esito = {
    livello: 'avviso',
    codice: 'PARETE_MIN',
    pezzo: 'Telaio',
    valore: 1,
    soglia: 1.2,
    messaggio: 'Sezione del telaio 1 mm: al limite, il minimo è 1,2 mm.',
  };
  it('should word an outcome with its piece, measure and minimum, or keep the recipe’s sentence', () => {
    expect(rigaEsito(esito, 'it')).toBe('Telaio: parete 1 mm, minimo 1,2 mm');
    expect(rigaEsito(esito, 'en')).toBe('Telaio: wall 1 mm, minimum 1.2 mm');
    expect(rigaEsito({ ...esito, codice: 'SFORMO_TESTO', messaggio: 'Lo sformo del testo è basso.' }, 'it')).toBe(
      'Lo sformo del testo è basso.',
    );
  });

  it('should name a parameter as a pattern maker does, values with their unit', () => {
    expect(rigaModifica(fibbia, { chiave: 'telaio.sezioneLarghezza', prima: 3, dopo: 2.4 }, 'it')).toEqual({
      id: 'telaio.sezioneLarghezza',
      etichetta: 'Larghezza sezione',
      prima: '3 mm',
      dopo: '2,4 mm',
    });
    expect(rigaModifica(fibbia, { chiave: 'telaio.profilo', prima: 'bombato', dopo: 'piatto' }, 'en')).toMatchObject({
      etichetta: 'Profile',
      prima: 'domed',
      dopo: 'flat',
    });
    // A parameter without a name of its own keeps its readable key.
    expect(
      rigaModifica(fibbia, { chiave: 'ardiglione.materiale', prima: 'acciaio', dopo: 'inox' }, 'it').etichetta,
    ).toBe('Ardiglione · Materiale');
  });
});

describe('chipsAssistente', () => {
  it('should put the checked correction first, then the variants and the material to try', () => {
    const chips = chipsAssistente({
      famiglia: fibbiaDiProva,
      correzioni: [
        {
          codice: 'ARDIGLIONE_D',
          pezzo: 'Ardiglione',
          soglia: 1.8,
          modifiche: [{ chiave: 'ardiglione.diametro', prima: 1.6, dopo: 1.8 }],
        },
      ],
      esiti: [],
      ipotesi: 0,
      language: 'it',
    });
    expect(chips.map((chip) => chip.testo)).toEqual([
      'Porta l’ardiglione a 1,8 mm',
      'Proponi 3 varianti',
      'Prova in ottone',
    ]);
    expect(chips[0]).toMatchObject({ tipo: 'modifica', origine: 'correzione' });
    expect(chips[2]).toMatchObject({
      tipo: 'modifica',
      origine: 'materiale',
      modifiche: [{ chiave: 'costruzione.processo', prima: 'pressofusione_zama', dopo: 'fusione_cera_persa' }],
    });
  });

  it('should ask to confirm the open assumptions before the variants', () => {
    const chips = chipsAssistente({ famiglia: fibbiaDiProva, correzioni: [], esiti: [], ipotesi: 2, language: 'it' });
    expect(chips.map((chip) => chip.testo)).toEqual(['Conferma le 2 ipotesi', 'Proponi 3 varianti', 'Prova in ottone']);
  });

  it('should end a clean model on the trade’s next step, which goes to the composer', () => {
    const chips = chipsAssistente({
      famiglia: { definizione: anello, variante: 'griffe', parametri: anello.predefiniti('griffe') },
      correzioni: [],
      esiti: [],
      ipotesi: 0,
      language: 'it',
    });
    expect(chips.map((chip) => chip.testo)).toEqual([
      'Proponi 3 varianti',
      'Prova in argento 925',
      'Prepara per la fusione',
    ]);
    const prossimo = chips[2];
    expect(prossimo?.tipo === 'scrivi' && prossimo.bozza.includes('cera persa')).toBe(true);
  });

  it('should give a free model the general suggestions, as drafts for the composer', () => {
    const chips = chipsAssistente({ correzioni: [], esiti: [], ipotesi: 0, language: 'it' });
    expect(chips.every((chip) => chip.tipo === 'scrivi')).toBe(true);
    expect(chips).toHaveLength(3);
  });
});

describe('schedaModello', () => {
  it('should sum up a buckle: family, key measures, material and weight, size, silhouette and assumptions', () => {
    const scheda = schedaModello({
      famiglia: fibbiaDiProva,
      pieces: [telaio, ardiglione],
      materials: {},
      iou: 0.9412,
      daFoto: true,
      ipotesi: 2,
      nome: 'Fibbia',
      language: 'it',
    });
    expect(scheda.titolo).toBe('Fibbia · rettangolare');
    expect(scheda.daFoto).toBe(true);
    expect(scheda.misure).toHaveLength(3);
    expect(scheda.dettagli).toEqual(['Zama ≈ 4,5 g', '27 × 18 × 5,6 mm']);
    expect(scheda.stato).toEqual(['sagoma 0,94', '2 ipotesi da controllare']);
  });

  it('should name a free model by the project and count its pieces, weighing in the material picked', () => {
    const scheda = schedaModello({
      pieces: [telaio],
      materials: { [telaio.id]: { material: 'brass' } },
      daFoto: false,
      ipotesi: 0,
      nome: 'Fermaglio',
      language: 'it',
    });
    expect(scheda.titolo).toBe('Fermaglio');
    expect(scheda.misure).toEqual([]);
    expect(scheda.dettagli).toEqual(['Ottone ≈ 4,1 g', '27 × 18 × 2,5 mm', '1 pezzo']);
    expect(scheda.stato).toEqual([]);
  });
});
