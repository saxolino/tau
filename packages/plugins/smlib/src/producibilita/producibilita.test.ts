/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import type { Esito } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import { controlliPezzo, esitiProducibilita, riepilogoProducibilita, unisciEsiti } from '#producibilita/esiti.js';
import { decodificaNomeStep, funzioniProducibilita } from '#producibilita/funzioni.js';
import { misuraModello, misuraPezzo } from '#producibilita/misure.js';
import type { ControlloProducibilita, MisurePezzo } from '#producibilita/tipi.js';

// Costruzioni B-rep e raggi ripetuti: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const su = [0, 0, 1] as const;
const trova = (controlli: readonly ControlloProducibilita[], codice: string): ControlloProducibilita | undefined =>
  controlli.find((riga) => riga.codice === codice);

/** Una scatola svuotata con la faccia superiore aperta: pareti dello spessore dato. */
const scatolaSvuotata = (spessore: number): Smlib.Part => {
  const box = lib.Box(20, 20, 20);
  return box.shell(
    spessore,
    box.faces().filter((faccia) => faccia.normalAt(faccia.interiorPoint()).z > 0.9),
  );
};

describe('misure e controlli di producibilità', () => {
  it('should block a 0,3 mm wall for gold lost-wax casting and pass a 2 mm one', () => {
    const sottile = misuraPezzo(lib, scatolaSvuotata(0.3), { nome: 'Guscio', direzione: su });
    expect(sottile.stato).toBe('chiuso');
    expect(sottile.spessoreMinimo).toBeCloseTo(0.3, 2);
    const controlli = controlliPezzo(sottile, { processo: 'fusione_cera_persa', materiale: 'oro_18kt_giallo' });
    const parete = trova(controlli, 'PARETE_MIN')!;
    expect(parete.livello).toBe('blocco');
    expect(parete.soglia).toBe(0.5);
    expect(parete.unita).toBe('mm');
    // Every wall of the shell is under the minimum; the faces carry the block level for the viewer.
    expect(parete.facce!.length).toBeGreaterThanOrEqual(5);
    expect(parete.facce!.every(({ livello }) => livello === 'blocco')).toBe(true);

    const spesso = misuraPezzo(lib, scatolaSvuotata(2), { nome: 'Guscio', direzione: su });
    const ok = trova(
      controlliPezzo(spesso, { processo: 'fusione_cera_persa', materiale: 'oro_18kt_giallo' }),
      'PARETE_MIN',
    )!;
    expect(ok.livello).toBe('ok');
    expect(ok.valore).toBeCloseTo(2, 1);
    expect(ok.facce).toHaveLength(0);
  });

  it('should warn, not block, a wall between the zama local and general minimum', () => {
    const misure = misuraPezzo(lib, scatolaSvuotata(1.1), { nome: 'Placca', direzione: su });
    const parete = trova(controlliPezzo(misure, { processo: 'pressofusione_zama' }), 'PARETE_MIN')!;
    expect(parete.livello).toBe('avviso');
    expect(parete.soglia).toBe(1.2);
  });

  it('should find a side hole as an undercut for zama and a hole along the pull as none', () => {
    const blocco = lib.Box(30, 20, 10);
    const traverso = blocco.cut(lib.Cylinder(2, 40).rotate(lib.Axis.Y, 90));
    const misure = misuraPezzo(lib, traverso, { nome: 'Blocco', direzione: su });
    const pareteForo = [...traverso.faces()].findIndex((faccia) => faccia.geomType === 'cylinder');
    expect(misure.intrappolate).toContain(pareteForo);
    const zama = controlliPezzo(misure, { processo: 'pressofusione_zama' });
    expect(trova(zama, 'SOTTOSQUADRO')).toMatchObject({ livello: 'blocco', evidenza: 'sformo' });
    expect(trova(zama, 'SOTTOSQUADRO')!.facce).toContainEqual({ faccia: pareteForo, livello: 'blocco' });
    // On a three-axis mill the same faces ask for another set-up: a warning.
    expect(trova(controlliPezzo(misure, { processo: 'cnc' }), 'SOTTOSQUADRO')!.livello).toBe('avviso');
    // Lost-wax casting has no rigid mould: no undercut check at all.
    expect(trova(controlliPezzo(misure, { processo: 'fusione_cera_persa' }), 'SOTTOSQUADRO')).toBeUndefined();

    const passante = misuraPezzo(lib, blocco.cut(lib.Cylinder(2, 40)), { nome: 'Blocco', direzione: su });
    expect(passante.intrappolate).toHaveLength(0);
    expect(trova(controlliPezzo(passante, { processo: 'pressofusione_zama' }), 'SOTTOSQUADRO')!.livello).toBe('ok');
  });

  it('should warn vertical walls under the zama draft and pass walls drafted by 2 degrees', () => {
    const box = lib.Box(20, 20, 10);
    const dritta = controlliPezzo(misuraPezzo(lib, box, { nome: 'Tappo', direzione: su }), {
      processo: 'pressofusione_zama',
    });
    const sformo = trova(dritta, 'SFORMO')!;
    expect(sformo).toMatchObject({ livello: 'avviso', valore: 0, soglia: 1, conteggio: 4, unita: 'deg' });
    const fianchi = box.faces().filter((faccia) => Math.abs(faccia.normalAt(faccia.interiorPoint()).z) < 0.1);
    const fondo = box.faces().find((faccia) => faccia.normalAt(faccia.interiorPoint()).z < -0.9)!;
    const sformata = box.draft(fianchi, 2, fondo);
    const ok = trova(
      controlliPezzo(misuraPezzo(lib, sformata, { nome: 'Tappo', direzione: su }), { processo: 'pressofusione_zama' }),
      'SFORMO',
    )!;
    expect(ok.livello).toBe('ok');
    expect(ok.valore).toBeCloseTo(2, 3);
  });

  it('should block a 0,5 mm hole for casting, warn a 0,75 mm one, and not take an inner fillet for a hole', () => {
    const lastra = lib.Box(20, 20, 3);
    const foro = (diametro: number): MisurePezzo =>
      misuraPezzo(lib, lastra.cut(lib.Cylinder(diametro / 2, 10)), { nome: 'Lastra', direzione: su });
    expect(foro(0.5).fori).toHaveLength(1);
    expect(foro(0.5).fori[0]!.facce).toHaveLength(1);
    expect(foro(0.5).fori[0]!.diametro).toBeCloseTo(0.5, 6);
    expect(trova(controlliPezzo(foro(0.5), { processo: 'fusione_cera_persa' }), 'FORO_MIN')!.livello).toBe('blocco');
    expect(trova(controlliPezzo(foro(0.75), { processo: 'fusione_cera_persa' }), 'FORO_MIN')!.livello).toBe('avviso');
    expect(trova(controlliPezzo(foro(1.2), { processo: 'fusione_cera_persa' }), 'FORO_MIN')!.livello).toBe('ok');

    // An L-shaped bracket whose inside corner is rounded by 0,3 mm: a concave cylinder that is no hole.
    const squadra = lib.Box(20, 10, 2).fuse(lib.Pos(-9, 0, 5).mul(lib.Box(2, 10, 10)));
    const interno = squadra.edges().concave();
    const raccordata = squadra.fillet(interno, 0.3);
    const misure = misuraPezzo(lib, raccordata, { nome: 'Squadra', direzione: su });
    expect([...raccordata.faces()].some((faccia) => faccia.geomType === 'cylinder')).toBe(true);
    expect(misure.fori).toHaveLength(0);
    expect(trova(controlliPezzo(misure, { processo: 'fusione_cera_persa' }), 'FORO_MIN')).toBeUndefined();
  });

  it('should block an open piece and skip the other checks on it', () => {
    const lamina = lib.Box(10, 10, 10).faces()[0]!.toShell();
    const misure = misuraPezzo(lib, lamina, { nome: 'Lamina', direzione: su });
    expect(misure.stato).toBe('aperto');
    const controlli = controlliPezzo(misure, { processo: 'stampa_3d_resina' });
    expect(controlli).toHaveLength(1);
    expect(controlli[0]).toMatchObject({ codice: 'SOLIDO_CHIUSO', livello: 'blocco', evidenza: 'pezzo' });
  });

  it('should measure prongs next to a stone: base diameter and height above the girdle', () => {
    const base = lib.Cylinder(3, 1);
    const griffe = [0, 90, 180, 270].map((angolo) => {
      const radianti = (angolo * Math.PI) / 180;
      return lib.Pos(2.1 * Math.cos(radianti), 2.1 * Math.sin(radianti), 2.4).mul(lib.Cylinder(0.3, 4.2));
    });
    const castone = base.fuse(...griffe);
    // A round stone of radius 2 whose girdle (widest section) sits at z = 4.
    const pietra = lib.Pos(0, 0, 4).mul(lib.Sphere(1.95));
    const misure = misuraModello(
      lib,
      [
        { nome: 'Castone', forma: castone },
        { nome: 'Pietra', forma: pietra, pietra: true },
      ],
      { direzione: su },
    );
    const [metallo, sasso] = misure.pezzi;
    expect(sasso!.pietra).toBe(true);
    expect(metallo!.griffe).toHaveLength(4);
    expect(metallo!.griffe[0]!.diametro).toBeCloseTo(0.6, 6);
    // Prongs end at z = 0.3 + 4.2 = 4.5: 0.5 mm above the girdle.
    expect(metallo!.griffe[0]!.sopraCintura).toBeCloseTo(0.5, 1);
    const controlli = esitiProducibilita(misure, [
      { nome: 'Castone', processo: 'fusione_cera_persa', materiale: 'oro_18kt_giallo' },
      { nome: 'Pietra', processo: 'fusione_cera_persa', pietra: true },
    ]);
    expect(trova(controlli, 'GRIFFA_BASE')).toMatchObject({ livello: 'avviso', soglia: 0.7, pezzo: 'Castone' });
    expect(controlli.some((riga) => riga.pezzo === 'Pietra')).toBe(false);
  });

  it('should merge a family check with the measured one: one row per code and piece, the worse level', () => {
    const misure = misuraPezzo(lib, scatolaSvuotata(2), { nome: 'Telaio', direzione: su });
    const misurati = controlliPezzo(misure, { processo: 'pressofusione_zama' });
    const famiglia: Esito[] = [
      {
        livello: 'blocco',
        codice: 'PARETE_MIN',
        pezzo: 'Telaio',
        valore: 0.9,
        soglia: 1.2,
        messaggio: 'Sezione 0,9 mm.',
      },
      { livello: 'ok', codice: 'SOLIDO_CHIUSO', pezzo: 'Telaio', messaggio: 'Telaio: chiuso.' },
      { livello: 'avviso', codice: 'LUCE_CINTURINO', valore: 3, messaggio: 'Gioco 3 mm.' },
      { livello: 'info', codice: 'PESO', pezzo: 'Telaio', valore: 12, messaggio: '12 g.' },
    ];
    const uniti = unisciEsiti(misurati, famiglia);
    expect(uniti.filter((riga) => riga.codice === 'PARETE_MIN')).toHaveLength(1);
    expect(trova(uniti, 'PARETE_MIN')).toMatchObject({
      livello: 'blocco',
      valore: 0.9,
      messaggio: 'Sezione 0,9 mm.',
      fonti: ['geometria', 'famiglia'],
    });
    expect(uniti.filter((riga) => riga.codice === 'SOLIDO_CHIUSO')).toHaveLength(1);
    expect(trova(uniti, 'LUCE_CINTURINO')).toMatchObject({ fonti: ['famiglia'], id: 'LUCE_CINTURINO|' });
    expect(trova(uniti, 'PESO')).toBeUndefined();
    expect(riepilogoProducibilita(uniti).blocchi).toBe(1);
  });
});

describe('analisi completa sulle famiglie predefinite (STEP del kernel → worker)', () => {
  it('should read back piece names the STEP writer encoded as ISO 10303-21 directives', () => {
    const sbarra = '\\';
    const diretta = (ampiezza: string, esadecimale: string): string =>
      `${sbarra}X${ampiezza}${sbarra}${esadecimale}${sbarra}X0${sbarra}`;
    expect(decodificaNomeStep(`Castone ${diretta('2', '00B7')} ${diretta('2', '00E0')}`)).toBe('Castone · à');
    expect(decodificaNomeStep(`Fiore ${diretta('4', '0001F338')}`)).toBe('Fiore 🌸');
    expect(decodificaNomeStep('Telaio')).toBe('Telaio');
  });

  const prove = [
    { id: 'fibbia', processo: 'pressofusione_zama' },
    { id: 'tacco', processo: 'stampaggio_iniezione' },
    { id: 'anello', processo: 'fusione_cera_persa' },
  ] as const;

  it.each(prove)(
    'should analyse the default $id within budget, faces aligned with the kernel body',
    ({ id, processo }) => {
      const famiglia = famiglie[id]!;
      const { pezzi } = valutaFamiglia(lib, famiglia, { verifiche: false });
      const corpi = pezzi.flatMap((pezzo) => (pezzo.shape instanceof lib.Part ? [pezzo.shape.named(pezzo.name)] : []));
      const inizioStep = performance.now();
      const step = lib.toStep(corpi, { assembly: true, name: id });
      const tempoStep = performance.now() - inizioStep;
      const richiesta = {
        step: new TextEncoder().encode(step),
        pezzi: pezzi.map((pezzo) => ({
          nome: pezzo.name,
          processo,
          materiale: pezzo.materiale,
          ...(pezzo.ruolo === 'pietra' ? { pietra: true } : {}),
        })),
        direzione: su,
        famiglia: { id },
      };
      funzioniProducibilita(lib).analizza({ ...richiesta, pezzi: [] });
      // Cold times: a fresh worker memory each round, the best of two.
      let migliore: ReturnType<ReturnType<typeof funzioniProducibilita>['analizza']> | undefined;
      for (let giro = 0; giro < 2; giro++) {
        const risposta = funzioniProducibilita(lib).analizza(richiesta);
        if (!migliore || risposta.tempi.totale < migliore.tempi.totale) {
          migliore = risposta;
        }
      }
      const risposta = migliore!;
      console.info(
        `${id}: STEP ${tempoStep.toFixed(0)} ms, lettura ${risposta.tempi.lettura.toFixed(0)} ms, misure ${risposta.tempi.misure.toFixed(0)} ms, famiglia ${risposta.tempi.famiglia.toFixed(0)} ms, totale ${risposta.tempi.totale.toFixed(0)} ms`,
      );
      expect(risposta.misure.pezzi).toHaveLength(pezzi.length);
      for (const [indice, misurato] of risposta.misure.pezzi.entries()) {
        const forma = pezzi[indice]!.shape as Smlib.Part;
        expect(misurato.facce).toBe([...forma.faces()].length);
      }
      expect(risposta.controlli.length).toBeGreaterThan(0);
      // One row per code and piece, after merging the family's own checks.
      expect(new Set(risposta.controlli.map((riga) => riga.id)).size).toBe(risposta.controlli.length);
      expect(risposta.esitiFamiglia.length).toBeGreaterThan(0);
      expect(risposta.controlli.some((riga) => riga.fonti.includes('famiglia'))).toBe(true);
      expect(risposta.tempi.totale).toBeLessThan(process.env['CI'] ? 20_000 : 10_000);
    },
  );

  it('should not measure the geometry again when only the process changes', () => {
    const { pezzi } = valutaFamiglia(lib, famiglie.fibbia!, { verifiche: false });
    const corpi = pezzi.flatMap((pezzo) => (pezzo.shape instanceof lib.Part ? [pezzo.shape.named(pezzo.name)] : []));
    const step = new TextEncoder().encode(lib.toStep(corpi, { assembly: true, name: 'fibbia' }));
    const { analizza } = funzioniProducibilita(lib);
    const richiesta = (processo: 'pressofusione_zama' | 'cnc') => ({
      step,
      pezzi: pezzi.map((pezzo) => ({ nome: pezzo.name, processo, materiale: pezzo.materiale })),
      direzione: su,
    });
    const prima = analizza(richiesta('pressofusione_zama'));
    // A face read back from STEP may put its interior point on its border: that sample must not read the 2,5 mm
    // frame as a 0,2 mm wall (the ray grazes the neighbouring face).
    expect(trova(prima.controlli, 'PARETE_MIN')).toMatchObject({ pezzo: 'Telaio', livello: 'ok' });
    expect(trova(prima.controlli, 'PARETE_MIN')!.valore).toBeGreaterThan(2);
    const dopo = analizza(richiesta('cnc'));
    expect(dopo.misure).toBe(prima.misure);
    expect(dopo.tempi.misure).toBeLessThan(5);
    expect(trova(prima.controlli, 'SFORMO')).toBeDefined();
    // A three-axis mill asks for no draft.
    expect(trova(dopo.controlli, 'SFORMO')).toBeUndefined();
  });
});
