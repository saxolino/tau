// @vitest-environment node
/* oxlint-disable no-console, no-await-in-loop -- il banco di prova stampa la tabella (è il suo prodotto) e misura i giri uno dopo l'altro. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { esbuildBundler } from '@taucad/esbuild';
import { defineRuntime } from '@taucad/runtime/worker';
import type { DocumentUpdate } from '@taucad/runtime';
import type { TelemetryEntry } from '@taucad/runtime/types';
import { createHash } from 'node:crypto';
import { WebIO } from '@gltf-transform/core';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import { smlib } from '#smlib.plugin.js';
import { famiglie } from '#famiglie/registro.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import { creaModuloFamiglie } from '#famiglie/modulo.js';
import type { FamigliaLegata } from '#famiglie/modulo.js';
import type { FamigliaQualsiasi, IdFamiglia, ParametriAnnidati, PezzoFamiglia } from '#famiglie/famiglia.js';
import { sondaTempi } from '#famiglie/sonda-tempi.js';

/**
 * Banco di prova della ricostruzione (27 ott 2026, studio text-to-cad, punto 1): dove va il tempo quando cambia UN
 * parametro di una famiglia, lungo il percorso vero del kernel (`smlib.kernel.ts`: bundle, `execute`, `runMain`,
 * sidecar manuale e replay, tassellatura, GLB). Nessun cambiamento al prodotto: le fasi si leggono dai span di
 * telemetria che il kernel già emette; il resto del giro (messaggi, coda, middleware) si ottiene per differenza.
 *
 * Come l'app: la vista chiede gli spigoli (`includeEdges`, `interactiveViewContent`) e l'export GLB la topologia
 * (`includeTopology`, `project-export.ts`). Il trascinamento manda aggiornamenti transitori e interattivi come
 * `cad.machine` durante lo scrub delle Misure.
 *
 * Si esegue solo con `SINOPIA_BENCH=1` (altrimenti salta: costa decine di secondi):
 *   SINOPIA_BENCH=1 corepack pnpm nx run smlib:test -- ricostruzione.bench
 * Memoria: RSS e heap JS del processo (il worker è in-process nel test) e `memoryUsage()` di SMLib (memoria in uso
 * del kernel e maniglie vive). Non c'è la cache di progetto (`geometry-cache.middleware`): il banco misura il costo
 * di un MISS, cioè quello che una cache per pezzo dovrebbe ridurre.
 */
const attivo = process.env['SINOPIA_BENCH'] === '1';
vi.setConfig({ testTimeout: 600_000 });

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
  /** L'impronta `.smb` dei pezzi per la cache delle mesh (dentro tassellatura ed export: non si somma al resto). */
  improntaForma: ['smlib.tessellate.fingerprint'],
} as const;
type NomeFase = keyof typeof fasiDefinite;
const nomiFasi = Object.keys(fasiDefinite) as NomeFase[];

type Campione = Record<NomeFase, number> & {
  totale: number;
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
/**
 * L'impronta delle MESH di un GLB (posizioni, normali e indici di ogni primitiva), il numero di triangoli e
 * l'estensione. Non i byte del file: il volume esatto che accompagna ogni pezzo può cambiare nelle ultime cifre a
 * seconda di cosa il kernel ha misurato prima (smlibwasm, piano T6), anche senza nessuna cache.
 * @param glb - I byte del GLB.
 * @returns Impronta, triangoli ed estensione in mm.
 */
const improntaMesh = async (
  glb: Uint8Array<ArrayBuffer>,
): Promise<{ impronta: string; triangoli: number; estensione: string }> => {
  const documento = await new WebIO().readBinary(glb);
  const hash = createHash('sha256');
  let triangoli = 0;
  const minimo = [Infinity, Infinity, Infinity];
  const massimo = [-Infinity, -Infinity, -Infinity];
  for (const primitiva of documento
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())) {
    const posizioni = primitiva.getAttribute('POSITION')?.getArray() ?? new Float32Array();
    const normali = primitiva.getAttribute('NORMAL')?.getArray() ?? new Float32Array();
    const indici = primitiva.getIndices()?.getArray() ?? new Uint32Array();
    for (const array of [posizioni, normali, indici]) {
      hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
    hash.update(JSON.stringify(primitiva.getExtras()));
    if (primitiva.getMode() !== 4) {
      continue;
    }
    triangoli += indici.length / 3;
    for (const [indice, valore] of posizioni.entries()) {
      const asse = indice % 3;
      minimo[asse] = Math.min(minimo[asse]!, valore);
      massimo[asse] = Math.max(massimo[asse]!, valore);
    }
  }
  return {
    impronta: hash.digest('hex').slice(0, 12),
    triangoli,
    estensione: massimo.map((alto, asse) => ((alto - minimo[asse]!) * 1000).toFixed(3)).join('×'),
  };
};

/** Contenuto della vista come lo chiede l'app (`interactiveViewContent`): con gli spigoli. */
const contenutoVista = { includeEdges: true } as const;
/** Contenuto dell'export GLB come lo chiede l'app (`project-export.ts`): con la topologia. */
const contenutoExport = { includeTopology: true } as const;

type Giro = {
  readonly parametri?: Record<string, unknown>;
  readonly modo?: 'commit' | 'trascina';
  readonly esporta?: 'dopo' | 'solo';
};

describe.skipIf(!attivo)('ricostruzione: dove va il tempo', () => {
  const righe: string[] = [];

  afterAll(() => {
    console.log(`\nBanco di prova della ricostruzione (ms; mediane):\n${righe.join('\n')}`);
  });

  it.each(casi)('should measure $id with one parameter changed', async (caso) => {
    const famiglia = famiglie[caso.id] as FamigliaQualsiasi;
    const base = famiglia.normalizza(famiglia.predefiniti(caso.variante), {
      variante: caso.variante,
    }) as unknown as Record<string, unknown>;
    const sorgente = emettiMainFamiglia(
      { id: caso.id, versione: 1, variante: caso.variante },
      base as unknown as ParametriAnnidati,
      {},
    );
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
    let ultimaVista: Uint8Array<ArrayBuffer> | undefined;
    let ultimoExport: Uint8Array<ArrayBuffer> | undefined;

    const giro = async ({ parametri, modo = 'commit', esporta }: Giro = {}): Promise<Campione> => {
      telemetria.length = 0;
      const inizio = performance.now();
      if (esporta !== 'solo') {
        if (parametri) {
          const cambio: DocumentUpdate =
            modo === 'trascina'
              ? { parameters: parametri, transient: true, interactive: true }
              : { parameters: parametri };
          const aggiornato = await documento.update(cambio as Parameters<typeof documento.update>[0]);
          expect(aggiornato.superseded).toBe(false);
        }
        const vista = documento.view('model', { content: contenutoVista });
        const esito = await vista.rendering();
        vista.close();
        if (esito.superseded || !esito.rendering.success) {
          throw new Error(`rendering fallito: ${JSON.stringify(esito).slice(0, 600)}`);
        }
        ultimaVista = esito.rendering.artifact.content as Uint8Array<ArrayBuffer>;
      }
      if (esporta) {
        const esportato = await documento.export('glb', { content: contenutoExport });
        if (!esportato.success) {
          throw new Error(`export fallito: ${JSON.stringify(esportato).slice(0, 600)}`);
        }
        ultimoExport = esportato.files[0].bytes;
      }
      const totale = performance.now() - inizio;
      await pausa(150);
      const somma = (nomi: readonly string[]): number =>
        telemetria.filter((voce) => nomi.includes(voce.name)).reduce((s, v) => s + v.duration, 0);
      const fasi = Object.fromEntries(nomiFasi.map((n) => [n, somma(fasiDefinite[n])])) as Record<NomeFase, number>;
      const memoria = process.memoryUsage();
      return {
        ...fasi,
        totale,
        heapJsMb: memoria.heapUsed / 1_048_576,
        rssMb: memoria.rss / 1_048_576,
        wasmMb: lib.memoryUsage().used / 1_048_576,
        maniglie: lib.memoryUsage().handles,
      };
    };

    const mediane = (campioni: readonly Campione[]): Campione =>
      Object.fromEntries(
        (Object.keys(campioni[0]!) as Array<keyof Campione>).map((k) => [k, mediana(campioni.map((c) => c[k]))]),
      ) as Campione;

    const stampa = (etichetta: string, c: Campione): void => {
      const noto = c.bundle + c.impronte + c.runMain + c.tassellatura + c.impacchetta + c.esportaGlb;
      righe.push(
        `${caso.id.padEnd(7)} ${etichetta.padEnd(16)} tot ${f0(c.totale)} | bundle ${f0(c.bundle)} impronte ${f0(c.impronte)} ` +
          `runMain ${f0(c.runMain)} tass ${f0(c.tassellatura)} (impronta ${c.improntaForma.toFixed(1)}) GLBpack ${f0(c.impacchetta)} export ${f0(c.esportaGlb)} ` +
          `altro ${f0(c.totale - noto)} | heapJS ${c.heapJsMb.toFixed(0)} MB rss ${c.rssMb.toFixed(0)} MB wasm ${c.wasmMb.toFixed(1)} MB maniglie ${c.maniglie}`,
      );
    };

    // A freddo: primo documento (WASM, bundler e esbuild da avviare).
    stampa('freddo', await giro());
    const vistaBase = ultimaVista!;
    // Export GLB a parte (solo al download, non a ogni modifica): primo export dopo il rendering.
    stampa('export primo', await giro({ esporta: 'solo' }));
    const exportBase = ultimoExport!;
    stampa('export ripetuto', mediane([await giro({ esporta: 'solo' }), await giro({ esporta: 'solo' })]));
    // A caldo, stesso input: tre giri senza cambiare nulla (cosa costa non cambiare niente).
    stampa('caldo-uguale', mediane([await giro({ parametri: { ...base } }), await giro({ parametri: { ...base } })]));

    // Una sola modifica, ogni volta a un valore nuovo, come i passi di un cursore trascinato: mai un valore già visto
    // (le cache non devono vincere per ripetizione).
    let progressivo = 0;
    const alternata = async (cambio: Cambio, opzioni: Omit<Giro, 'parametri'> = {}): Promise<Campione> => {
      const campioni: Campione[] = [];
      for (let n = 0; n < 5; n++) {
        progressivo++;
        const parametri = impostaAnnidato(base, { ...cambio, fattore: cambio.fattore * (1 + 0.004 * progressivo) });
        campioni.push(await giro({ ...opzioni, parametri }));
      }
      return mediane(campioni);
    };
    // Un giro a vuoto per evitare il primo effetto di JIT sulla nuova forma.
    await giro({ parametri: impostaAnnidato(base, caso.uno) });
    stampa('1 pezzo', await alternata(caso.uno));
    stampa('tutto', await alternata(caso.tutto));
    stampa('trascina 1 pezzo', await alternata(caso.uno, { modo: 'trascina' }));
    stampa('trascina tutto', await alternata(caso.tutto, { modo: 'trascina' }));
    // Rilascio dopo il trascinamento: l'ultimo valore trascinato si conferma, e il rendering a riposo è quello fine.
    stampa(
      'rilascio',
      await giro({
        parametri: impostaAnnidato(base, { ...caso.tutto, fattore: caso.tutto.fattore * (1 + 0.004 * progressivo) }),
      }),
    );
    // Export dopo una modifica di un pezzo (il download dopo aver cambiato una misura).
    await giro({ parametri: impostaAnnidato(base, caso.uno), esporta: 'dopo' });
    stampa('1 pezzo + export', await alternata(caso.uno, { esporta: 'dopo' }));

    // Le mesh fini a riposo devono restare quelle di oggi: si torna ai predefiniti e si confrontano le impronte.
    await giro({ parametri: { ...base } });
    const vistaRitorno = ultimaVista!;
    await giro({ esporta: 'solo' });
    const testo = async (glb: Uint8Array<ArrayBuffer>): Promise<string> => {
      const { impronta, triangoli, estensione } = await improntaMesh(glb);
      return `${impronta} (${triangoli} triangoli, ${estensione} mm)`;
    };
    righe.push(
      `${caso.id.padEnd(7)} mesh predefiniti: vista ${await testo(vistaBase)}, di nuovo dopo le modifiche ${await testo(vistaRitorno)}; ` +
        `export ${await testo(exportBase)}, di nuovo ${await testo(ultimoExport!)}`,
    );
    await giro({ parametri: impostaAnnidato(base, caso.uno) });
    righe.push(`${caso.id.padEnd(7)} mesh «1 pezzo»: vista ${await testo(ultimaVista!)}`);

    // Memoria: 20 modifiche di fila, ciascuna a un valore nuovo (aggiornamento + rendering), poi una pausa.
    const prima20 = lib.memoryUsage();
    for (let n = 0; n < 20; n++) {
      await documento.update({
        parameters: impostaAnnidato(base, { ...caso.uno, fattore: caso.uno.fattore * (1 + 0.002 * (2 * n + 1)) }),
      });
      const vista = documento.view('model', { content: contenutoVista });
      await vista.rendering();
      vista.close();
    }
    const dopo20 = lib.memoryUsage();
    await pausa(1000);
    const riposo20 = lib.memoryUsage();
    righe.push(
      `${caso.id.padEnd(7)} memoria 20 modifiche: WASM in uso ${(prima20.used / 1_048_576).toFixed(1)} -> ${(dopo20.used / 1_048_576).toFixed(1)} MB ` +
        `(dopo 1 s ${(riposo20.used / 1_048_576).toFixed(1)} MB, heap ${(riposo20.heap / 1_048_576).toFixed(0)} MB), ` +
        `maniglie ${prima20.handles} -> ${dopo20.handles} (dopo 1 s ${riposo20.handles}), heap JS ${(process.memoryUsage().heapUsed / 1_048_576).toFixed(0)} MB`,
    );

    // Costo per pezzo (stesse costruzioni, fuori dal kernel, con la sonda accesa): quanto pesa ciascun pezzo in runMain.
    const p = famiglia.normalizza(famiglia.predefiniti(caso.variante), { variante: caso.variante });
    const legata = creaModuloFamiglie(lib)[caso.id] as FamigliaLegata;
    legata.costruisci(p, { variante: caso.variante });
    sondaTempi.voci.length = 0;
    sondaTempi.attiva = true;
    const mAlloc = lib.memoryUsage();
    for (let n = 0; n < 5; n++) {
      legata.costruisci(p, { variante: caso.variante });
    }
    sondaTempi.attiva = false;
    const perPezzo = new Map<string, number[]>();
    for (const { pezzo, ms } of sondaTempi.voci) {
      perPezzo.set(pezzo, [...(perPezzo.get(pezzo) ?? []), ms]);
    }
    righe.push(
      `${caso.id.padEnd(7)} per pezzo (mediana di 5): ${[...perPezzo].map(([n, v]) => `${n} ${mediana(v).toFixed(0)} ms`).join(', ')}`,
    );
    // Memoria: 5 costruzioni di fila dal modulo `@sinopia/famiglie`, senza tornare all'event loop.
    const dopo = lib.memoryUsage();
    righe.push(
      `${caso.id.padEnd(7)} memoria WASM dopo 5 costruzioni dal modulo: ${(mAlloc.used / 1_048_576).toFixed(1)} -> ${(dopo.used / 1_048_576).toFixed(1)} MB (heap ${(dopo.heap / 1_048_576).toFixed(0)} MB), maniglie ${mAlloc.handles} -> ${dopo.handles}`,
    );
    // Snapshot della cache di progetto su un MISS (come `serializeSmlibHandle` + codec): toSmb per pezzo, msgpack, SHA-256;
    // e il ripristino su un HIT (fromSmb). La parte `geometry-cache.middleware` (IndexedDB/SQLite) non è inclusa.
    const pezzi: PezzoFamiglia[] = legata.costruisci(p, { variante: caso.variante });
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
    const msToSmbBinario = t(() => corpi.map((c) => lib.toSmb(c, { ascii: false })));
    const msPack = t(() => msgpackEncode({ shapes: smbs }, { ignoreUndefined: true }));
    const msSha = t(() => smbs.map((b) => createHash('sha256').update(b).digest('hex')));
    const msFrom = t(() => smbs.map((b) => lib.fromSmb(b)));
    righe.push(
      `${caso.id.padEnd(7)} snapshot (MISS): toSmb ${msToSmb.toFixed(1)} (binario ${msToSmbBinario.toFixed(1)}) + msgpack ${msPack.toFixed(1)} + sha256 ${msSha.toFixed(1)} ms su ${Math.trunc(smbs.reduce((s2, b) => s2 + b.length, 0) / 1024)} KiB; ripristino (HIT) fromSmb ${msFrom.toFixed(1)} ms`,
    );

    documento.close();
    await client.shutdown();
  });
});
