// @vitest-environment node
/* oxlint-disable no-await-in-loop -- le modifiche di un documento vanno in sequenza: ciascuna supera la precedente. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { esbuildBundler } from '@taucad/esbuild';
import { defineRuntime } from '@taucad/runtime/worker';
import { WebIO } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { smlib } from '#smlib.plugin.js';
import { famiglie } from '#famiglie/registro.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import type { FamigliaQualsiasi, ParametriAnnidati } from '#famiglie/famiglia.js';

/*
 * La tassellatura per pezzo con cache, la tolleranza grossa del trascinamento e la liberazione degli handle, lungo il
 * percorso vero del kernel (documento, vista, export). Il riferimento è sempre un kernel nuovo con gli stessi
 * parametri: le mesh riusate devono essere quelle che lui tassella da zero.
 */
vi.setConfig({ testTimeout: 120_000 });

type Parametri = Record<string, unknown> & { ardiglione: { diametro: number }; cinturino: { larghezza: number } };

const famiglia: FamigliaQualsiasi = famiglie.fibbia!;
const base = famiglia.normalizza(famiglia.predefiniti('rettangolare'), {
  variante: 'rettangolare',
}) as unknown as Parametri;
const conArdiglione = (fattore: number): Parametri => {
  const p = structuredClone(base);
  p.ardiglione.diametro *= fattore;
  return p;
};
const sorgente = emettiMainFamiglia(
  { id: 'fibbia', versione: 1, variante: 'rettangolare' },
  base as unknown as ParametriAnnidati,
  {},
);

const clienti: Array<{ shutdown: () => Promise<void> }> = [];
const nuovoCliente = () => {
  const client = createTestRuntimeClient({
    runtime: defineRuntime({ plugins: [smlib()], bundlers: [esbuildBundler()] }),
    files: { 'main.ts': sorgente },
  });
  clienti.push(client);
  return client;
};
afterEach(async () => {
  await Promise.all(clienti.splice(0).map(async (client) => client.shutdown()));
});

type Documento = ReturnType<ReturnType<typeof nuovoCliente>['open']>;

/** Posizioni, normali, indici ed extras di ogni primitiva: la mesh, senza i numeri esatti che viaggiano col pezzo. */
const mesh = async (
  glb: Uint8Array<ArrayBuffer> | string,
): Promise<{ impronta: string; triangoli: number; topologia: boolean }> => {
  if (typeof glb === 'string') {
    throw new TypeError('atteso un GLB binario');
  }
  const bytes = glb;
  const documento = await new WebIO().readBinary(bytes);
  const hash = createHash('sha256');
  let triangoli = 0;
  for (const primitiva of documento
    .getRoot()
    .listMeshes()
    .flatMap((voce) => voce.listPrimitives())) {
    for (const accessore of [
      primitiva.getAttribute('POSITION'),
      primitiva.getAttribute('NORMAL'),
      primitiva.getIndices(),
    ]) {
      const array = accessore?.getArray();
      if (array) {
        hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
    }
    hash.update(JSON.stringify(primitiva.getExtras()));
    if (primitiva.getMode() === 4) {
      triangoli += (primitiva.getIndices()?.getCount() ?? 0) / 3;
    }
  }
  const json = new TextDecoder().decode(
    bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)),
  );
  return { impronta: hash.digest('hex'), triangoli, topologia: json.includes('TAU_cad_topology') };
};

const vista = async (documento: Documento): Promise<{ glb: Uint8Array<ArrayBuffer>; linearTolerance: number }> => {
  const aperta = documento.view('model', { content: { includeEdges: true } });
  const esito = await aperta.rendering();
  aperta.close();
  if (esito.superseded || !esito.rendering.success) {
    throw new Error('rendering fallito');
  }
  return {
    glb: esito.rendering.artifact.content as Uint8Array<ArrayBuffer>,
    linearTolerance: esito.rendering.artifact.tessellation?.linearTolerance ?? Number.NaN,
  };
};

const esporta = async (documento: Documento): Promise<Uint8Array<ArrayBuffer>> => {
  const esito = await documento.export('glb', { content: { includeTopology: true } });
  if (!esito.success) {
    throw new Error('export fallito');
  }
  return esito.files[0].bytes;
};

/** Vista ed export di un kernel nuovo, aperto direttamente sui parametri. */
const daZero = async (
  parametri: Parametri,
): Promise<{ vista: Uint8Array<ArrayBuffer>; export: Uint8Array<ArrayBuffer> }> => {
  const documento = nuovoCliente().open({ source: { path: 'main.ts' }, parameters: parametri });
  const { glb } = await vista(documento);
  const file = await esporta(documento);
  documento.close();
  return { vista: glb, export: file };
};

describe('tassellatura per pezzo con cache', () => {
  it('should render and export, after a run of edits, exactly the meshes a fresh kernel tessellates', async () => {
    const documento = nuovoCliente().open({ source: { path: 'main.ts' }, parameters: {} });
    await vista(documento);
    for (const fattore of [1.1, 1.2, 1.1, 1, 1.2]) {
      await documento.update({ parameters: conArdiglione(fattore) });
      const atteso = await daZero(conArdiglione(fattore));
      const resa = await vista(documento);
      expect(await mesh(resa.glb)).toEqual(await mesh(atteso.vista));
      const esportato = await mesh(await esporta(documento));
      expect(esportato).toEqual(await mesh(atteso.export));
      // The faces and edges of each piece stay selectable in the delivered GLB.
      expect(esportato.topologia).toBe(true);
    }
  });

  it('should mesh a drag sample coarser, render the same values fine once settled, and never export a coarse mesh', async () => {
    const documento = nuovoCliente().open({ source: { path: 'main.ts' }, parameters: {} });
    const fine = await vista(documento);
    const trascinato = conArdiglione(1.15);
    const atteso = await daZero(trascinato);

    await documento.update({ parameters: trascinato, transient: true, interactive: true });
    const grossa = await vista(documento);
    expect(grossa.linearTolerance).toBeCloseTo(fine.linearTolerance * 4, 12);
    const meshGrossa = await mesh(grossa.glb);
    const meshFine = await mesh(atteso.vista);
    expect(meshGrossa.triangoli).toBeLessThan(meshFine.triangoli);
    // The export reads the committed values (still the defaults), at export quality.
    const predefiniti = await daZero(base);
    expect(await mesh(await esporta(documento))).toEqual(await mesh(predefiniti.export));

    // Held still: the same values, still transient, render fine.
    await documento.update({ parameters: trascinato, transient: true });
    const ferma = await vista(documento);
    expect(await mesh(ferma.glb)).toEqual(meshFine);

    // Released: committed, rendered and exported fine.
    await documento.update({ parameters: trascinato });
    const rilasciata = await vista(documento);
    expect(await mesh(rilasciata.glb)).toEqual(meshFine);
    expect(await mesh(await esporta(documento))).toEqual(await mesh(atteso.export));
  });

  it('should keep the live kernel handles and memory flat across twenty edits', async () => {
    const lib = await import('@classcad/smlibwasm');
    const documento = nuovoCliente().open({ source: { path: 'main.ts' }, parameters: {} });
    await vista(documento);
    const prima = lib.memoryUsage();
    for (let passo = 1; passo <= 20; passo++) {
      await documento.update({ parameters: conArdiglione(1 + passo / 100) });
      await vista(documento);
    }
    const dopo = lib.memoryUsage();
    // The two pieces of the current build, give or take the one before it: not one handle per intermediate body.
    expect(dopo.handles).toBeLessThanOrEqual(prima.handles + 4);
    expect(dopo.used - prima.used).toBeLessThan(4 * 1024 * 1024);
  });
});
