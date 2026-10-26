import type { FamigliaQualsiasi, IdFamiglia } from '#famiglie/famiglia.js';
import { fibbia } from '#famiglie/fibbia.js';
import { tacco } from '#famiglie/tacco.js';

/** Le famiglie realizzate, per id (le altre della specifica arrivano nei task successivi). */
export const famiglie: Partial<Record<IdFamiglia, FamigliaQualsiasi>> = { fibbia, tacco };
