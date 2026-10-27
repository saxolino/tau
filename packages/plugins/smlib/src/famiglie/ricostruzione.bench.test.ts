// @vitest-environment node
/* oxlint-disable no-console -- il banco di prova stampa la tabella: è il suo prodotto. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { esbuildBundler } from '@taucad/esbuild';
import { defineRuntime } from '@taucad/runtime/worker';
import type { TelemetryEntry } from '@taucad/runtime/types';
import { createHash } from 'node:crypto';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import { smlib } from '#smlib.plugin.js';
import { famiglie } from '#famiglie/registro.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import type { FamigliaQualsiasi, IdFamiglia } from '#famiglie/famiglia.js';
import { sondaTempi } from '#famiglie/sonda-tempi.js';

/**
 * Banco di prova della ricostruzione (27 ott 2026, studio text-to-cad, punto 1): dove va il tempo quando cambia UN
 * parametro di una famiglia, lungo il percorso vero del kernel (`smlib.kernel.ts`: bundle, `execute`, `runMain`,
 * sidecar manuale e replay, tassellatura, GLB). Nessun cambiamento al prodotto: le fasi si leggono dai span di
 * telemetria che il kernel già emette; il resto del giro (messaggi, coda, middleware) si ottiene per differenza.
 *
 * Si esegue solo con `SINOPIA_BENCH=1` (altrimenti salta: costa decine di secondi):
 *   SINOPIA_BENCH=1 corepack pnpm nx run smlib:test -- ricostruzione.bench
 * Memoria: RSS e heap JS del processo (il worker è in-process nel test) e `HEAPU8.length` della memoria lineare
 * WASM se SMLib la espone. Non c'è la cache di progetto (`geometry-cache.middleware`): il banco misura il costo di
 * un MISS, cioè quello che una cache per pezzo dovrebbe ridurre.
 */
const attivo = process.env['SINOPIA_BENCH'] === '1';
vi.setConfig({ testTimeout: 300_000 });

type Cambio = { readonly percorso: string; readonly fattore: number };
type Caso = {
  readonly id: IdFamiglia;
  readonly variante: string;
  /** Un parametro che tocca UN solo pezzo. */
  readonly uno: Cambio;
  /** Un parametro che tocca tutto. */
  readonly tutto: Cambio;
};

const casi: readonly Caso[] = [
  {
    id: 'fibbia',
    variante: 'rettangolare',
    uno: { percorso: 'ardiglione.diametro', fattore: 1.1 },
    tutto: { percorso: 'cinturino.larghezza', fattore: 1.1 },
  },
  {
    id: 'tacco',
    variante: 'stiletto',
    uno: { percorso: 'tappo.larghezza', fattore: 0.95 },
    tutto: { percorso: 'tacco.altezza', fattore: 1.15 },
  },
  {
    id: 'anello',
    variante: 'griffe',
    uno: { percorso: 'pietra.diametro', fattore: 1.1 },
    tutto: { percorso: 'taglia.valore', fattore: 1.2 },
  },
];

const impostaAnnidato = (base: Record<string, unknown>, { percorso, fattore }: Cambio): Record<string, unknown> => {
  const copia = structuredClone(base);
  const parti = percorso.split('.');
  let cursore = copia;
  for (const parte of parti.slice(0, -1)) {
    cursore = cursore[parte] as Record<string, unknown>;
  }
  const chiave = parti.at(-1)!;
  cursore[chiave] = (cursore[chiave] as number) * fattore;
  return copia;
};

/** Le fasi (ms) lette dai span; ciascuna è una somma di span senza sovrapposizioni tra loro. */
const fasiDefinite = {
  bundle: ['kernel.bundle'],
  impronte: ['deps.content-hash', 'deps.discover', 'deps.resolve-deps', 'kernel.resolve-deps'],
  esecuzione: ['kernel.execute'],
  runMain: ['smlib.run-main'],
  tassellatura: ['smlib.render-output'],
  impacchetta: ['smlib.mesh-to-gltf'],
  esportaGlb: ['export.renderGlbTessellation', 'export.packGltf'],
} as const;
type NomeFase = keyof typeof fasiDefinite;
const nomiFasi = Object.keys(fasiDefinite) as NomeFase[];

type Campione = Record<NomeFase, number> & {
  totale: number;
  resto: number;
  heapJsMb: number;
  rssMb: number;
  wasmMb: number;
  maniglie: number;
};

const mediana = (valori: readonly number[]): number =>
  [...valori].sort((a, b) => a - b)[Math.floor(valori.length / 2)]!;
const pausa = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const f0 = (n: number): string => n.toFixed(0).padStart(6);

describe.skipIf(!attivo)('ricostruzione: dove va il tempo', () => {
  const righe: string[] = [];

  afterAll(() => {
    console.log(`\nBanco di prova della ricostruzione (ms; mediana di 5 per le modifiche):\n${righe.join('\n')}`);
  });

  it.each(casi)('should measure $id with one parameter changed', async (caso) => {
    const famiglia = famiglie[caso.id] as FamigliaQualsiasi;
    const base = famiglia.normalizza(famiglia.predefiniti(caso.variante), {
      variante: caso.variante,
    }) as unknown as Record<string, unknown>;
    const sorgente = emettiMainFamiglia({ id: caso.id, versione: 1, variante: caso.variante }, base as never, {});
    const telemetria: TelemetryEntry[] = [];
    const client = createTestRuntimeClient({
      runtime: defineRuntime({ plugins: [smlib()], bundlers: [esbuildBundler()] }),
      files: { 'main.ts': sorgente },
    });
    client.on('telemetry', (lotto) => {
      telemetria.push(...lotto.entries);
    });
    const lib = await import('@classcad/smlibwasm');

    const documento = client.open({ source: { path: 'main.ts' }, parameters: {} });

    const giro = async (parametri: Record<string, unknown> | undefined, conExport = false): Promise<Campione> => {
      telemetria.length = 0;
      const inizio = performance.now();
      if (parametri) {
        const aggiornato = await documento.update({ parameters: parametri });
        expect(aggiornato.superseded).toBe(false);
      }
      const vista = documento.view('model', {});
      const esito = await vista.rendering();
      vista.close();
      if (esito.superseded || !esito.rendering.success) {
        throw new Error(`rendering fallito: ${JSON.stringify(esito).slice(0, 600)}`);
      }
      if (conExport) {
        const esportato = await documento.export('glb');
        if (!esportato.success) {
          throw new Error(`export fallito: ${JSON.stringify(esportato).slice(0, 600)}`);
        }
      }
      const totale = performance.now() - inizio;
      await pausa(200);
      const somma = (nomi: readonly string[]): number =>
        telemetria.filter((voce) => nomi.includes(voce.name)).reduce((s, v) => s + v.duration, 0);
      const fasi = Object.fromEntries(nomiFasi.map((n) => [n, somma(fasiDefinite[n])])) as Record<NomeFase, number>;
      const memoria = process.memoryUsage();
      return {
        ...fasi,
        totale,
        resto: 0,
        heapJsMb: memoria.heapUsed / 1_048_576,
        rssMb: memoria.rss / 1_048_576,
        wasmMb: lib.memoryUsage().used / 1_048_576,
        maniglie: lib.memoryUsage().handles,
      };
    };

    const mediane = (campioni: readonly Campione[]): Campione => {
      const m = Object.fromEntries(
        (Object.keys(campioni[0]!) as Array<keyof Campione>).map((k) => [k, mediana(campioni.map((c) => c[k]))]),
      ) as Campione;
      return m;
    };

    const stampa = (etichetta: string, c: Campione): void => {
      const noto = c.bundle + c.impronte + c.runMain + c.tassellatura + c.impacchetta + c.esportaGlb;
      righe.push(
        `${caso.id.padEnd(7)} ${etichetta.padEnd(11)} tot ${f0(c.totale)} | bundle ${f0(c.bundle)} impronte ${f0(c.impronte)} ` +
          `runMain ${f0(c.runMain)} tass ${f0(c.tassellatura)} GLBpack ${f0(c.impacchetta)} export ${f0(c.esportaGlb)} ` +
          `altro ${f0(c.totale - noto)} | heapJS ${c.heapJsMb.toFixed(0)} MB rss ${c.rssMb.toFixed(0)} MB wasm ${c.wasmMb.toFixed(1)} MB maniglie ${c.maniglie}`,
      );
    };

    // A freddo: primo documento (WASM, bundler e esbuild da avviare).
    const freddo = await giro(undefined);
    stampa('freddo', freddo);
    // Export GLB a parte (solo al download, non a ogni modifica): primo export dopo il rendering.
    stampa('+export GLB', await giro({ ...base }, true));
    // A caldo, stesso input: due giri senza cambiare nulla (cosa costa non cambiare niente).
    stampa('caldo-uguale', mediane([await giro({ ...base }), await giro({ ...base }), await giro({ ...base })]));

    // Una sola modifica, alternando due valori (mai lo stesso input due volte di fila).
    const alternata = async (cambio: Cambio): Promise<Campione> => {
      const campioni: Campione[] = [];
      const originale = impostaAnnidato(base, cambio);
      const altro = impostaAnnidato(base, { ...cambio, fattore: cambio.fattore * 1.03 });
      for (let n = 0; n < 5; n++) {
        campioni.push(await giro(n % 2 === 0 ? originale : altro));
      }
      return mediane(campioni);
    };
    // Un giro a vuoto per evitare il primo effetto di JIT sulla nuova forma.
    await giro(impostaAnnidato(base, caso.uno));
    stampa(`1 pezzo`, await alternata(caso.uno));
    stampa(`tutto`, await alternata(caso.tutto));

    // Costo per pezzo (stesse costruzioni, fuori dal kernel, con la sonda accesa): quanto pesa ciascun pezzo in runMain.
    const p = famiglia.normalizza(famiglia.predefiniti(caso.variante), { variante: caso.variante });
    famiglia.costruisci(lib, p, { variante: caso.variante });
    sondaTempi.voci.length = 0;
    sondaTempi.attiva = true;
    const mAlloc = lib.memoryUsage();
    for (let n = 0; n < 5; n++) {
      famiglia.costruisci(lib, p, { variante: caso.variante });
    }
    sondaTempi.attiva = false;
    const perPezzo = new Map<string, number[]>();
    for (const { pezzo, ms } of sondaTempi.voci) {
      perPezzo.set(pezzo, [...(perPezzo.get(pezzo) ?? []), ms]);
    }
    righe.push(
      `${caso.id.padEnd(7)} per pezzo (mediana di 5): ${[...perPezzo].map(([n, v]) => `${n} ${mediana(v).toFixed(0)} ms`).join(', ')}`,
    );
    // Snapshot della cache di progetto su un MISS (come `serializeSmlibHandle` + codec): toSmb per pezzo, msgpack, SHA-256;
    // e il ripristino su un HIT (fromSmb). La parte `geometry-cache.middleware` (IndexedDB/SQLite) non è inclusa.
    const pezzi = famiglia.costruisci(lib, p, { variante: caso.variante });
    const corpi = pezzi.map(({ shape }) => shape as InstanceType<typeof lib.Part>);
    const t = (f: () => unknown): number => {
      f();
      const m: number[] = [];
      for (let n = 0; n < 5; n++) {
        const i = performance.now();
        f();
        m.push(performance.now() - i);
      }
      return mediana(m);
    };
    const smbs = corpi.map((c) => new Uint8Array(lib.toSmb(c)));
    const msToSmb = t(() => corpi.map((c) => new Uint8Array(lib.toSmb(c))));
    const msPack = t(() => msgpackEncode({ shapes: smbs }, { ignoreUndefined: true }));
    const msSha = t(() => smbs.map((b) => createHash('sha256').update(b).digest('hex')));
    const msFrom = t(() => smbs.map((b) => lib.fromSmb(b)));
    righe.push(
      `${caso.id.padEnd(7)} snapshot (MISS): toSmb ${msToSmb.toFixed(1)} + msgpack ${msPack.toFixed(1)} + sha256 ${msSha.toFixed(1)} ms su ${(smbs.reduce((s2, b) => s2 + b.length, 0) / 1024) | 0} KiB; ripristino (HIT) fromSmb ${msFrom.toFixed(1)} ms`,
    );
    // Memoria: 5 costruzioni di fila senza tornare all'event loop; le maniglie si liberano solo col GC (nessun dispose/scope in famiglie).
    const dopo = lib.memoryUsage();
    righe.push(
      `${caso.id.padEnd(7)} memoria WASM dopo 5 costruzioni dirette: ${(mAlloc.used / 1_048_576).toFixed(1)} -> ${(dopo.used / 1_048_576).toFixed(1)} MB (heap ${(dopo.heap / 1_048_576).toFixed(0)} MB), maniglie ${mAlloc.handles} -> ${dopo.handles}`,
    );

    documento.close();
    await client.shutdown();
  });
});
