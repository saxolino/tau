// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { registerTauGltfExtensions } from '@taucad/geometry-core';
import type { TauCadTopologyPayload, TauCadTopologyRoot } from '@taucad/geometry-core';
import { tauCadTopologyExtension } from '@taucad/runtime/types';
import { esbuildBundler } from '@taucad/esbuild';
import { defineRuntime } from '@taucad/runtime/worker';
import { assertRenderingSuccess, createTestRuntimeClient, extractGltfFromResult } from '@taucad/runtime-testing';
import { smlibKernel } from '#smlib.kernel.js';
import { fibbia } from '#famiglie/fibbia.js';
import { tacco } from '#famiglie/tacco.js';

/**
 * T-D1-10: il `main.ts` che `emettiMain` scrive per un progetto gira davvero nel kernel SMLib, importando la ricetta
 * dal modulo built-in `@sinopia/famiglie`: pezzi nominati con densità, ipotesi nelle Misure, parametri modificabili.
 */
vi.setConfig({ testTimeout: 60_000 });

const makeClient = (files: Record<string, string>) =>
  createTestRuntimeClient({
    runtime: defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] }),
    files,
  });
const clients = new Set<ReturnType<typeof makeClient>>();
afterEach(async () => {
  await Promise.all([...clients].map(async (client) => client.shutdown()));
  clients.clear();
});

type Componente = { name: string; sourceRefs?: Record<string, unknown> };

const componenti = async (
  client: ReturnType<typeof makeClient>,
  parameters?: Record<string, unknown>,
): Promise<Componente[]> => {
  const document = client.open({ source: { path: 'main.ts' }, ...(parameters ? { parameters } : {}) });
  const rendered = await document.view('model', { content: { includeTopology: true } }).rendering();
  if (rendered.superseded) {
    throw new Error('Resa superata');
  }
  assertRenderingSuccess(rendered.rendering);
  const bytes = extractGltfFromResult(rendered.rendering)!;
  const letto = await registerTauGltfExtensions(new NodeIO()).readBinary(bytes);
  const topologia = letto.getRoot().getExtension<TauCadTopologyRoot>(tauCadTopologyExtension)?.getPayload() as
    | TauCadTopologyPayload
    | undefined;
  document.close();
  return (topologia?.components ?? []) as Componente[];
};

describe('modulo built-in @sinopia/famiglie', () => {
  it('should run the emitted main.ts of a buckle and keep the assumptions in the parameters', async () => {
    const main = fibbia.emettiMain(
      fibbia.predefiniti(),
      { 'cinturino.larghezza': 'Dalla misura dichiarata, 20 mm.' },
      { variante: 'rettangolare' },
    );
    const client = makeClient({ 'main.ts': main });
    clients.add(client);
    const descritto = await client.describe({ source: { path: 'main.ts' } });
    if (!descritto.success) {
      throw new Error(descritto.issues.map(({ message }) => message).join('\n'));
    }
    expect(descritto.parameters.defaults).toMatchObject({
      cinturino: { larghezza: 20 },
      telaio: { profilo: 'bombato' },
    });
    expect(descritto.parameters.schema).toMatchObject({
      properties: {
        cinturino: { properties: { larghezza: { description: '[sinopia:assumed] Dalla misura dichiarata, 20 mm.' } } },
      },
    });
    const pezzi = await componenti(client);
    const nomi = pezzi.map(({ name }) => name);
    expect(nomi).toEqual(expect.arrayContaining(['Telaio', 'Ardiglione']));
    const telaio = pezzi.find(({ name }) => name === 'Telaio');
    expect(telaio?.sourceRefs?.['density']).toBe(6.7);
    expect(Number(telaio?.sourceRefs?.['volumeMm3'])).toBeGreaterThan(100);
  });

  it('should run the emitted main.ts of a heel and rebuild it when a measure changes', async () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } });
    const client = makeClient({ 'main.ts': tacco.emettiMain(p, {}, { variante: 'stiletto' }) });
    clients.add(client);
    const prima = await componenti(client);
    expect(prima.map(({ name }) => name)).toEqual(expect.arrayContaining(['Tacco DX', 'Tappo DX', 'Anima DX']));
    const volume = (pezzi: Componente[]) =>
      Number(pezzi.find(({ name }) => name === 'Tacco DX')?.sourceRefs?.['volumeMm3']);
    expect(prima.find(({ name }) => name === 'Tacco DX')?.sourceRefs?.['density']).toBe(1.05);
    const basso = await componenti(client, { ...p, tacco: { ...p.tacco, altezza: 70 } });
    expect(volume(basso)).toBeLessThan(volume(prima));
    expect(volume(basso)).toBeGreaterThan(0);
  });
});
