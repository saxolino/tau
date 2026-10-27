/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (processi, materiali, varianti, taglie): snake_case come in Sinopia. */
import type { Processo } from '#famiglie/famiglia.js';

/**
 * Soglie di producibilità per processo (specifica §1.10). Sono numeri «di mestiere da confermare col fornitore»:
 * ogni soglia porta `fonte: 'mestiere'` e sarà modificabile in Impostazioni (fase 2). `riferimenti` nomina le guide
 * pubbliche dei fornitori da cui i numeri partono; dove il mestiere è più prudente della guida vale il mestiere.
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
  /** Diametro minimo di un foro (mm): sotto, l'anima si spezza, la punta flette o il foro si chiude. */
  foroMinimo?: number;
  /** Diametro minimo di una griffa alla base (mm), dove il processo tiene pietre. */
  griffaMinima?: number;
  /**
   * Come pesa un sottosquadro rispetto alla direzione di sformo: `blocco` dove lo stampo non si apre senza carrelli,
   * `avviso` dove serve un altro piazzamento (CNC a tre assi), `libero` dove il processo non ha stampo rigido.
   */
  sottosquadro: 'blocco' | 'avviso' | 'libero';
  note: string;
  /** Guide dei fornitori da cui partono i numeri (da confermare col fornitore). */
  riferimenti: readonly string[];
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
    foroMinimo: 0.8,
    griffaMinima: 0.7,
    sottosquadro: 'libero',
    note: 'Ritiro della cera 1,5–2 %: dichiarato nell’export, non applicato al modello. Nessuno sformo: il rivestimento avvolge la cera.',
    riferimenti: [
      'Shapeways, linee guida dei metalli preziosi a cera persa: parete sostenuta 0,6 mm, filo 0,8 mm.',
      'Banco orafo (valutazione Fable 26 ott §3.2): griffe ≥ 0,7 mm alla base, fori ≥ 0,8 mm.',
    ],
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
    foroMinimo: 1,
    griffaMinima: 1,
    sottosquadro: 'blocco',
    note: 'Niente sottosquadri senza carrelli; galvanica 5–15 µm non modellata.',
    riferimenti: [
      'NADCA, Product Specification Standards for Die Castings: lo zinco ammette pareti più sottili; per la minuteria si tiene il mestiere.',
      'Minuteria calzatura (valutazione Fable 26 ott, calzature §2.4): pareti 1–1,5 mm, sformo 1–2°, raggi ≥ 0,3 mm, nessun sottosquadro senza carrelli.',
    ],
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
    foroMinimo: 1,
    sottosquadro: 'blocco',
    note: 'Ritiro 0,5–1,2 % (gomma 1,5–2 %, EVA 1,5–2,5 %): dichiarato nell’export, non applicato.',
    riferimenti: [
      'Fondificio (valutazione Fable 26 ott, calzature §2.2): TR/TPU ≥ 1,5–2 mm, sformi 1–2° sui fianchi e 3–5° sui tasselli; gomma ≥ 2,5–3 mm; EVA ≥ 3 mm.',
    ],
    fonte: 'mestiere',
  },
  tranciatura_lamiera: {
    processo: 'tranciatura_lamiera',
    pareteMinima: 0.4,
    pareteMinimaPerMateriale: {},
    sformoPerMateriale: {},
    foroMinimo: 1,
    sottosquadro: 'libero',
    note: 'Raggio interno di piega almeno pari allo spessore; un foro tranciato almeno quanto lo spessore.',
    riferimenti: ['Regola di tranciatura: diametro del foro ≥ spessore della lamiera.'],
    fonte: 'mestiere',
  },
  cnc: {
    processo: 'cnc',
    pareteMinima: 0.8,
    pareteMinimaPerMateriale: { legno_faggio: 6, ottone: 0.8, alluminio: 0.8 },
    sformoPerMateriale: {},
    raggioMinimo: 1,
    foroMinimo: 1,
    griffaMinima: 0.8,
    sottosquadro: 'avviso',
    note: 'Raggio interno almeno pari al raggio della fresa (⌀ 2 mm); un sottosquadro chiede un altro piazzamento o una fresa a T.',
    riferimenti: [
      'Protolabs Network (Hubs), guida alla progettazione CNC: pareti 0,8 mm consigliate nei metalli (0,5 mm fattibili).',
    ],
    fonte: 'mestiere',
  },
  stampa_3d_resina: {
    processo: 'stampa_3d_resina',
    pareteMinima: 0.4,
    pareteMinimaPerMateriale: {},
    sformoPerMateriale: {},
    foroMinimo: 0.5,
    griffaMinima: 0.5,
    sottosquadro: 'libero',
    note: 'Per prototipo o modello calcinabile per la fusione: per il metallo valgono poi le soglie della cera persa.',
    riferimenti: [
      'Formlabs, guida alla progettazione per la stampa SLA: pareti 0,2 mm sostenute e 0,4 mm libere, fori ⌀ 0,5 mm.',
    ],
    fonte: 'mestiere',
  },
  stampa_3d_metallo: {
    processo: 'stampa_3d_metallo',
    pareteMinima: 0.5,
    pareteMinimaPerMateriale: {},
    sformoPerMateriale: {},
    foroMinimo: 1.5,
    griffaMinima: 1,
    sottosquadro: 'libero',
    note: 'Fusione laser su letto di polvere: gli sbalzi oltre 45° chiedono supporti, la polvere va svuotata dai fori.',
    riferimenti: [
      'Protolabs Network (Hubs), guida alla stampa 3D in metallo (DMLS/SLM): pareti 0,4 mm sostenute e 0,5 mm libere, fori ⌀ 1,5 mm, perni ⌀ 1 mm.',
    ],
    fonte: 'mestiere',
  },
  taglio_cuoio: {
    processo: 'taglio_cuoio',
    pareteMinima: 3.5,
    pareteMinimaPerMateriale: { cuoio: 3.5 },
    sformoPerMateriale: {},
    sottosquadro: 'libero',
    note: 'Spessore fisso 3,5–6 mm, nessuno sformo.',
    riferimenti: ['Fondo in cuoio (valutazione Fable 26 ott, calzature §2.2): spessore fisso del taglio 3,5–5 mm.'],
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

/** Il tratto minimo non scende mai sotto questo (mm): la linea più fine che nessun processo del catalogo tiene. */
const trattoAssolutoMinimo = 0.3;

/**
 * Il tratto minimo di un segno in rilievo o in incisione (testo, logo) per processo: un terzo della parete minima
 * generica del processo, mai sotto 0,3 mm. Dà 0,4 mm in pressofusione (parete 1,2), 0,3 mm in cera persa, in
 * tranciatura, in CNC e nelle stampe 3D.
 * @param processo - Processo produttivo.
 * @returns Millimetri.
 * @public
 */
export const sogliaTratto = (processo: Processo): number =>
  Math.max(trattoAssolutoMinimo, Math.round((soglieProcessi[processo].pareteMinima / 3) * 100) / 100);
