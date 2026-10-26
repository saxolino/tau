import type { FamigliaQualsiasi, IdFamiglia } from '#famiglie/famiglia.js';

/** Le famiglie realizzate, per id (le altre della specifica arrivano nei task successivi). */
export const famiglie: Partial<Record<IdFamiglia, FamigliaQualsiasi>> = {};
