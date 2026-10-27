#!/usr/bin/env node
// Prova dei worker della build statica di SinopiaCAD (quella che va su sinopialab.com/cad).
//
// Serve la cartella della build sotto il suo sottopercorso (`/cad/`) con le intestazioni di Vercel
// (`vercel/vercel.json`: COOP, COEP, CORP, nosniff), apre in Chromium headless una pagina vuota della stessa origine
// (isolata come quella vera, senza avviare l'app né chiamare servizi esterni), crea ogni worker SMLib di SinopiaCAD come
// fa l'interfaccia (`new Worker(url, { type: 'module' })`) e aspetta il suo «pronto»: il messaggio che `expose()` di
// `@classcad/smlibwasm/worker` manda solo dopo aver caricato le funzioni e il kernel WebAssembly. Un worker vuoto (il suo
// `expose()` scartato dal bundler), uno che non si carica o uno il cui kernel non si istanzia fanno fallire la prova.
// Controlla anche che nessun file `*.worker-*.js` della build sia vuoto.
//
// Uso: node scripts/sinopiacad/prova-worker.mjs [cartella della build]   (predefinita: apps/ui/serve/build/client)
// `build.sh` la lancia dopo ogni build: se un worker non risponde, la build fallisce.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(process.argv[2] ?? path.join(qui, '../../apps/ui/serve/build/client'));
const base = process.env.SINOPIACAD_BASE ?? '/cad/';
/** Millisecondi di attesa del «pronto» di ogni worker. */
const attesa = Number(process.env.PROVA_WORKER_ATTESA_MS ?? 90_000);
/** I worker SMLib di SinopiaCAD, per nome del file sorgente (il bundler aggiunge `-<hash>.js`). */
const WORKER = ['producibilita.worker', 'verifica-silhouette.worker', 'varianti.worker', 'consegna.worker'];
/** Il messaggio di `expose()` (`@classcad/smlibwasm/worker`): `{ [TAG]: 'ready', names }` o `{ [TAG]: 'ready', error }`. */
const TAG = '$smlibwasm';
const PAGINA = `${base}__prova-worker.html`;

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** Le intestazioni che Vercel mette su ogni risposta (`source: "/(.*)"`). */
async function intestazioniVercel() {
  const config = JSON.parse(await readFile(path.join(qui, 'vercel/vercel.json'), 'utf8'));
  const tutte = config.headers.find((h) => h.source === '/(.*)');
  if (!tutte) throw new Error('vercel.json: manca il blocco di intestazioni "/(.*)"');
  return Object.fromEntries(tutte.headers.map((h) => [h.key, h.value]));
}

function fallisci(messaggio) {
  console.error(`✗ prova-worker: ${messaggio}`);
  process.exitCode = 1;
}

const assets = path.join(radice, 'assets');
const nomi = await readdir(assets).catch(() => {
  throw new Error(`nessuna build in ${radice} (manca assets/): lancia prima scripts/sinopiacad/build.sh`);
});

// 1. Nessun worker vuoto nella build (un modulo il cui contenuto il bundler ha scartato tutto).
for (const nome of nomi.filter((n) => /\.worker-[\w-]+\.js$/u.test(n))) {
  const { size } = await stat(path.join(assets, nome));
  if (size < 64) fallisci(`${nome} è vuoto (${size} byte): il bundler ha scartato il suo contenuto`);
}

// 2. I worker SMLib di SinopiaCAD.
const trovati = WORKER.map((w) => {
  const file = nomi.find((n) => n.startsWith(`${w}-`) && n.endsWith('.js'));
  if (!file) fallisci(`nessun file ${w}-*.js nella build`);
  return { worker: w, url: file ? `${base}assets/${file}` : undefined };
}).filter((t) => t.url);

const intestazioni = await intestazioniVercel();
/** I file serviti: il kernel WebAssembly di SMLib deve esserci (un «pronto» arriva solo dopo averlo istanziato). */
const serviti = new Set();
const server = createServer(async (richiesta, risposta) => {
  const percorso = decodeURIComponent(new URL(richiesta.url, 'http://x').pathname);
  serviti.add(percorso);
  if (percorso === PAGINA) {
    risposta.writeHead(200, { ...intestazioni, 'Content-Type': TIPI['.html'] });
    risposta.end('<!doctype html><meta charset="utf-8"><title>prova worker</title>');
    return;
  }
  if (!percorso.startsWith(base)) {
    risposta.writeHead(404, intestazioni).end();
    return;
  }
  const file = path.join(radice, percorso.slice(base.length));
  if (!file.startsWith(radice)) {
    risposta.writeHead(403, intestazioni).end();
    return;
  }
  try {
    const corpo = await readFile(file);
    risposta.writeHead(200, {
      ...intestazioni,
      'Content-Type': TIPI[path.extname(file)] ?? 'application/octet-stream',
    });
    risposta.end(corpo);
  } catch {
    risposta.writeHead(404, intestazioni).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origine = `http://127.0.0.1:${server.address().port}`;

// Il Chromium di Playwright se è installato, altrimenti il Google Chrome della macchina (stesso motore).
const browser = await chromium.launch({ headless: true }).catch((errore) => {
  if (!String(errore?.message).includes("Executable doesn't exist")) throw errore;
  return chromium.launch({ headless: true, channel: 'chrome' });
});
try {
  const pagina = await browser.newPage();
  pagina.on('pageerror', (errore) => {
    console.error(`  [pagina] ${errore.message}`);
  });
  await pagina.goto(`${origine}${PAGINA}`);
  const isolata = await pagina.evaluate(() => globalThis.crossOriginIsolated);
  if (!isolata) fallisci('la pagina di prova non è crossOriginIsolated: le intestazioni COOP/COEP non arrivano');

  const esiti = await pagina.evaluate(
    async ({ trovati, TAG, attesa }) =>
      Promise.all(
        trovati.map(
          ({ worker, url }) =>
            new Promise((risolvi) => {
              const inizio = performance.now();
              const w = new Worker(url, { type: 'module', name: worker });
              const fine = (esito) => {
                clearTimeout(timer);
                w.terminate();
                risolvi({ worker, url, ms: Math.round(performance.now() - inizio), ...esito });
              };
              const timer = setTimeout(() => {
                fine({ ok: false, errore: `nessuna risposta in ${attesa} ms` });
              }, attesa);
              w.addEventListener('message', ({ data }) => {
                if (data?.[TAG] !== 'ready') return;
                if (data.error) fine({ ok: false, errore: `funzioni non caricate: ${JSON.stringify(data.error)}` });
                else if (!Array.isArray(data.names) || data.names.length === 0)
                  fine({ ok: false, errore: 'nessuna funzione esposta' });
                else fine({ ok: true, funzioni: data.names });
              });
              w.addEventListener('error', (evento) => {
                evento.preventDefault();
                fine({ ok: false, errore: `il modulo non si carica: ${evento.message || 'errore senza messaggio'}` });
              });
            }),
        ),
      ),
    { trovati, TAG, attesa },
  );
  for (const esito of esiti) {
    if (esito.ok) console.log(`✓ ${esito.worker} pronto in ${esito.ms} ms (${esito.funzioni.join(', ')})`);
    else fallisci(`${esito.worker} (${esito.url}): ${esito.errore}`);
  }
  if (![...serviti].some((p) => /\/smlibwasm-[\w-]+\.wasm$/u.test(p))) {
    fallisci('nessun worker ha chiesto il kernel smlibwasm-*.wasm');
  }
} finally {
  await browser.close();
  server.close();
}
if (process.exitCode) console.error('✗ prova-worker: almeno un worker della build non risponde');
else console.log(`✓ prova-worker: ${WORKER.length} worker SMLib rispondono nella build servita sotto ${base}`);
