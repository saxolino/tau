import type { FamigliaQualsiasi, IdFamiglia } from '#famiglie/famiglia.js';
import { anello } from '#famiglie/anello.js';
import { borchia } from '#famiglie/borchia.js';
import { fibbia } from '#famiglie/fibbia.js';
import { fondoSemplice } from '#famiglie/fondo-semplice.js';
import { occhiello } from '#famiglie/occhiello.js';
import { placca } from '#famiglie/placca.js';
import { tacco } from '#famiglie/tacco.js';

/** Le famiglie realizzate, per id (le altre della specifica arrivano nei task successivi). */
export const famiglie: Partial<Record<IdFamiglia, FamigliaQualsiasi>> = {
  fibbia,
  tacco,
  placca,
  occhiello,
  borchia,
  anello,
  fondo_semplice: fondoSemplice,
};
