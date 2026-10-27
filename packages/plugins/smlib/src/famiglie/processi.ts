/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (processi, materiali, varianti, taglie): snake_case come in Sinopia. */
import type { Processo } from '#famiglie/famiglia.js';

/**
 * Soglie di producibilità per processo (specifica §1.10). Sono numeri «di mestiere da confermare col fornitore»:
 * ogni soglia porta `fonte: 'mestiere'` e sarà modificabile in Impostazioni (fase 2).
 * @public
 */
export type SoglieProcesso = {
  processo: Processo;
  /** Parete minima generica (mm). */
  pareteMinima: number;
  /** Parete minima per materiale (chiavi di `materiali.ts`), dove il processo la distingue. */
  pareteMinimaPerMateriale: Readonly<Record<string, number>>;
  /** Parete minima ammessa in un punto locale (zama: 1,0 locale). */
  pareteMinimaLocale?: number;
  /** Sformo minimo dei fianchi (gradi); assente dove il processo non lo chiede. */
  sformoMinimo?: number;
  /** Sformo minimo per materiale (gomma 3°, EVA 2°). */
  sformoPerMateriale: Readonly<Record<string, number>>;
  /** Sformo dei tasselli e delle parti profonde (gradi). */
  sformoTasselli?: number;
  /** Raggio minimo dei raccordi (mm). */
  raggioMinimo?: number;
  /** Ritiro lineare atteso, in percento [min, max]. */
  ritiro?: readonly [number, number];
  note: string;
  fonte: 'mestiere';
};

/**
 * Soglie di producibilità per processo (§1.10).
 * @public
 */
export const soglieProcessi: Readonly<Record<Processo, SoglieProcesso>> = {
  fusione_cera_persa: {
    processo: 'fusione_cera_persa',
    pareteMinima: 0.6,
    pareteMinimaPerMateriale: {
      oro_18kt_giallo: 0.5,
      oro_18kt_rosa: 0.5,
      oro_18kt_bianco: 0.5,
      oro_14kt: 0.5,
      oro_9kt: 0.5,
      argento_925: 0.6,
      platino_950: 0.4,
      ottone: 1,
      bronzo: 1,
    },
    sformoPerMateriale: {},
    raggioMinimo: 0.2,
    ritiro: [1.5, 2],
    note: 'Ritiro della cera 1,5–2 %: dichiarato nell’export, non applicato al modello.',
    fonte: 'mestiere',
  },
  pressofusione_zama: {
    processo: 'pressofusione_zama',
    pareteMinima: 1.2,
    pareteMinimaPerMateriale: {},
    pareteMinimaLocale: 1,
    sformoMinimo: 1,
    sformoPerMateriale: {},
    raggioMinimo: 0.3,
    note: 'Niente sottosquadri senza carrelli; galvanica 5–15 µm non modellata.',
    fonte: 'mestiere',
  },
  stampaggio_iniezione: {
    processo: 'stampaggio_iniezione',
    pareteMinima: 1.8,
    pareteMinimaPerMateriale: { abs: 1.8, pa6: 1.8, pa_gf30: 1.8, pu: 2, tr: 1.5, tpu: 1.5, gomma: 2.5, eva: 3 },
    sformoMinimo: 1,
    sformoPerMateriale: { gomma: 3, eva: 2 },
    sformoTasselli: 3,
    raggioMinimo: 0.5,
    ritiro: [0.5, 1.2],
    note: 'Ritiro 0,5–1,2 % (gomma 1,5–2 %, EVA 1,5–2,5 %): dichiarato nell’export, non applicato.',
    fonte: 'mestiere',
  },
  tranciatura_lamiera: {
    processo: 'tranciatura_lamiera',
    pareteMinima: 0.4,
    pareteMinimaPerMateriale: {},
    sformoPerMateriale: {},
    note: 'Raggio interno di piega almeno pari allo spessore.',
    fonte: 'mestiere',
  },
  cnc: {
    processo: 'cnc',
    pareteMinima: 0.8,
    pareteMinimaPerMateriale: { legno_faggio: 6, ottone: 0.8, alluminio: 0.8 },
    sformoPerMateriale: {},
    raggioMinimo: 1,
    note: 'Raggio interno almeno pari al raggio della fresa (⌀ 2 mm).',
    fonte: 'mestiere',
  },
  stampa_3d_resina: {
    processo: 'stampa_3d_resina',
    pareteMinima: 0.4,
    pareteMinimaPerMateriale: {},
    sformoPerMateriale: {},
    note: 'Per prototipo o modello calcinabile per la fusione.',
    fonte: 'mestiere',
  },
  taglio_cuoio: {
    processo: 'taglio_cuoio',
    pareteMinima: 3.5,
    pareteMinimaPerMateriale: { cuoio: 3.5 },
    sformoPerMateriale: {},
    note: 'Spessore fisso 3,5–6 mm, nessuno sformo.',
    fonte: 'mestiere',
  },
};

/**
 * La parete minima per processo e materiale.
 * @param processo - Processo produttivo.
 * @param materiale - Chiave di `materiali.ts`.
 * @returns Millimetri.
 * @public
 */
export const sogliaParete = (processo: Processo, materiale?: string): number => {
  const soglie = soglieProcessi[processo];
  return (materiale === undefined ? undefined : soglie.pareteMinimaPerMateriale[materiale]) ?? soglie.pareteMinima;
};

/**
 * Lo sformo minimo per processo e materiale, o undefined dove il processo non lo chiede.
 * @param processo - Processo produttivo.
 * @param materiale - Chiave di `materiali.ts`.
 * @returns Gradi.
 * @public
 */
export const sogliaSformo = (processo: Processo, materiale?: string): number | undefined => {
  const soglie = soglieProcessi[processo];
  return (materiale === undefined ? undefined : soglie.sformoPerMateriale[materiale]) ?? soglie.sformoMinimo;
};
