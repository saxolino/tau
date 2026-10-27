/* oxlint-disable no-barrel-files/no-barrel-files -- the assistant's entry (D4 brief, D5 variants), like `verifica/index.ts`. */
export {
  ASSI_VARIANTE,
  attenuaProposta,
  chiaviMobili,
  differenzeParametri,
  insiemeAgente,
  mosseFamiglie,
  normalizzati,
  proponiVarianti,
} from '#varianti/assi.js';
export type { AsseVariante, Differenza, OpzioniVarianti, PropostaVariante } from '#varianti/assi.js';
export {
  bersagliEsiti,
  candidatiCorrezione,
  chiaveMateriale,
  materialeFamiglia,
  provaMateriale,
} from '#varianti/mestiere.js';
export type { Correzione, Modifica } from '#varianti/mestiere.js';
export type {
  Controllo,
  ControlloAttuale,
  EsitoVarianti,
  RichiestaControllo,
  RichiestaVarianti,
  VarianteValutata,
} from '#varianti/varianti-funzioni.js';
export { creaValutatoreVarianti } from '#varianti/varianti-client.js';
export type { ValutatoreVarianti } from '#varianti/varianti-client.js';
