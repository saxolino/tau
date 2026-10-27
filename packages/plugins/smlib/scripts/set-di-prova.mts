#!/usr/bin/env -S node --import @oxc-node/core/register
/**
 * Set di prova sintetico della verifica D3 (T-D3-07): costruisce ogni pezzo del set con parametri veri, ne rende la
 * silhouette da una camera nota, perturba stima e vista, lancia l'ottimizzatore e misura IoU, errore in mm sulle misure
 * critiche e tempo. Nessuna chiamata a modelli AI.
 *
 * Usage:
 *   pnpm nx run smlib:set-di-prova --uscita=/percorso/cartella [--famiglie=tacco,fibbia] [--budget=45000] [--senza-scala]
 *
 * Writes to the output folder (default `out/reports/smlib/set-di-prova`):
 *   risultati-<data>.json — every case, with phases, camera, errors per parameter;
 *   tabelle-<data>.md — the per-family and per-measure tables;
 *   prima-dopo-<caso>.png — the difference picture before and after (one case per family).
 *
 * Exit codes:
 *   0 — every case ran.
 *   1 — a case threw.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import * as lib from '@classcad/smlibwasm';
import { codificaPng } from '#verifica/png.js';
import {
  affianca,
  eseguiCaso,
  riassunto,
  SET_SINTETICO,
  tabellaMarkdown,
  tabellaPerMisura,
} from '#verifica/set-sintetico.js';
import type { RisultatoCaso } from '#verifica/set-sintetico.js';

const argomento = (nome: string): string | undefined =>
  process.argv.find((voce) => voce.startsWith(`--${nome}=`))?.slice(nome.length + 3);

const radice = resolve(import.meta.dirname, '../../../..');
const uscita = resolve(argomento('uscita') ?? join(radice, 'out/reports/smlib/set-di-prova'));
const famiglieScelte = argomento('famiglie')?.split(',');
const budgetMs = Number(argomento('budget') ?? 45_000);
// Senza scala dichiarata (fonte «stima»): l'ottimizzatore muove anche pxPerMm; l'errore conta in percentuale.
const senzaScala = process.argv.includes('--senza-scala');
mkdirSync(uscita, { recursive: true });

const data = `${new Date().toISOString().slice(0, 10)}${senzaScala ? '-senza-scala' : ''}`;
const voci = SET_SINTETICO.filter((voce) => !famiglieScelte || famiglieScelte.includes(voce.famiglia));
const risultati: RisultatoCaso[] = [];
const conImmagine = new Set<string>();
const inizio = performance.now();
for (const [indice, voce] of voci.entries()) {
  const { risultato, prima, dopo } = eseguiCaso(lib, voce, { budgetMs, ...(senzaScala ? { senzaScala } : {}) });
  risultati.push(risultato);
  const critiche = risultato.errori
    .filter((errore) => errore.critico && errore.unita === 'mm')
    .map((errore) => `${errore.chiave} ${(errore.ottimizzato - errore.vero).toFixed(2)}`)
    .join(' · ');
  process.stdout.write(
    `[${indice + 1}/${voci.length}] ${risultato.id}: IoU ${risultato.iouPrima.toFixed(3)} → ${risultato.iouDopo.toFixed(3)}` +
      ` (verità ${risultato.iouVerita.toFixed(3)}) · ${(risultato.tempoMs / 1000).toFixed(1)} s · ${critiche}\n`,
  );
  if (!voce.nota && !senzaScala && !conImmagine.has(voce.famiglia)) {
    conImmagine.add(voce.famiglia);
    writeFileSync(join(uscita, `prima-dopo-${risultato.id}.png`), await codificaPng(affianca(prima, dopo)));
  }
}
const righe = riassunto(risultati);
writeFileSync(
  join(uscita, `risultati-${data}.json`),
  `${JSON.stringify({ data, budgetMs, risultati, righe }, null, 2)}\n`,
);
writeFileSync(
  join(uscita, `tabelle-${data}.md`),
  `## Per famiglia\n\n${tabellaMarkdown(righe)}\n\n## Per misura critica\n\n${tabellaPerMisura(risultati)}\n`,
);
process.stdout.write(
  `\n${tabellaMarkdown(righe)}\n\n${tabellaPerMisura(risultati)}\n\n${voci.length} casi in ${((performance.now() - inizio) / 1000).toFixed(0)} s → ${uscita}\n`,
);
