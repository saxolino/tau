/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (processi, materiali, varianti, taglie): snake_case come in Sinopia. */
import type * as Smlib from '@classcad/smlibwasm';
import type {
  DefinizioneParametro,
  Esito,
  Famiglia,
  OpzioniFamiglia,
  PezzoFamiglia,
  Processo,
  RisultatoCostruzione,
} from '#famiglie/famiglia.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import { aspettoMateriale, materiale } from '#famiglie/materiali.js';
import { limita, normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaParete, soglieProcessi } from '#famiglie/processi.js';
import { diametroInterno, intervalliTaglia } from '#famiglie/taglie-anello.js';
import type { SistemaTaglia } from '#famiglie/taglie-anello.js';
import { esitiPezzi, esito, esitoMinimo, mm, normalizzaForma } from '#famiglie/verifiche-comuni.js';
import { misuraPezzo } from '#famiglie/sonda-tempi.js';
import { faccia as f } from '#famiglie/viste.js';

/**
 * Famiglia `anello` (specifica §1.7): gambo + castone semplice, fusione a cera persa.
 *
 * Telaio locale: asse del dito = Y, l'anello «sta in piedi» con la testa in +Z. Il gambo è il profilo (piatto
 * all'interno) girato attorno a Y; con la rastremazione è un `loft` chiuso di 8 profili scalati attorno al bordo
 * interno (il foro resta tondo): `sweep` con scala su un cerchio intero regge ma costa ≈ 350 ms (esiti T-D1-02).
 */

type Lib = typeof Smlib;

/**
 * Varianti della famiglia anello.
 * @public
 */
export type VarianteAnello = 'griffe' | 'chiuso' | 'fascia';

const leghe = [
  'oro_18kt_giallo',
  'oro_18kt_rosa',
  'oro_18kt_bianco',
  'oro_14kt',
  'oro_9kt',
  'argento_925',
  'platino_950',
  'titanio',
] as const;

/**
 * Parametri della famiglia anello, annidati per pezzo.
 * @public
 */
export type ParametriAnello = {
  taglia: { sistema: SistemaTaglia; valore: number };
  gambo: {
    profilo: 'tondo' | 'mezzotondo' | 'piatto' | 'd' | 'comfort';
    larghezza: number;
    spessore: number;
    rastremazione: number;
  };
  castone: { tipo: 'chiuso' | 'griffe' | 'nessuno'; parete: number; labbro: number; sede: number };
  pietra: { taglio: 'tondo'; diametro: number };
  griffe: { numero: number; diametro: number; altezzaSopraCintura: number };
  lega: (typeof leghe)[number];
};

const varianti = ['griffe', 'chiuso', 'fascia'] as const;

const diametroDi = (p: ParametriAnello): number => diametroInterno(p.taglia.sistema, p.taglia.valore);
const altezzaPietra = (p: ParametriAnello): number => 0.61 * p.pietra.diametro;
/**
 * Altezza del castone: 0,9 × altezza della pietra + 0,5 (§1.7); il chiuso si alza quanto serve perché il
 * padiglione (0,43 × diametro sotto la cintura) resti 0,2 mm sopra il fondo (con la formula sola, un brillante di
 * 5 mm sporgerebbe di 0,28 mm).
 */
const altezzaCastone = (p: ParametriAnello): number => {
  const base = altezzaPietra(p) * 0.9 + 0.5;
  return p.castone.tipo === 'chiuso'
    ? Math.max(base, 0.43 * p.pietra.diametro + p.castone.sede * altezzaPietra(p) + 0.2)
    : base;
};
/** Quota della cintura della pietra sopra la base del castone. */
const quotaCintura = (p: ParametriAnello): number => altezzaCastone(p) - p.castone.sede * altezzaPietra(p);

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'taglia.sistema',
    unita: 'enum',
    valori: ['it', 'us', 'eu_iso', 'diametro'],
    default: 'it',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Sistema di taglie',
  },
  {
    chiave: 'taglia.valore',
    unita: 'n',
    min: 1,
    max: 76,
    passo: 0.5,
    default: 14,
    fonteDefault: 'mestiere',
    critico: true,
    descrizione: 'Taglia (IT 1–35 · US 3–15 · ISO 41–76 · mm 13–24)',
  },
  {
    chiave: 'taglia.diametroInterno',
    unita: 'mm',
    default: 17.19,
    fonteDefault: 'derivato',
    derivato: (p) => diametroDi(p as ParametriAnello),
    descrizione: 'Diametro interno dalla taglia',
  },
  {
    chiave: 'gambo.profilo',
    unita: 'enum',
    valori: ['tondo', 'mezzotondo', 'piatto', 'd', 'comfort'],
    default: 'mezzotondo',
    fonteDefault: 'mestiere',
    descrizione: 'Profilo del gambo',
  },
  {
    chiave: 'gambo.larghezza',
    unita: 'mm',
    min: 1.5,
    max: 10,
    default: 3,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza del gambo in alto',
  },
  {
    chiave: 'gambo.spessore',
    unita: 'mm',
    min: 1,
    max: 4,
    default: 1.8,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Spessore del gambo in alto',
  },
  {
    chiave: 'gambo.rastremazione',
    unita: 'frazione',
    min: 0.5,
    max: 1,
    default: 0.8,
    fonteDefault: 'mestiere',
    descrizione: 'Gambo in basso / in alto',
  },
  {
    chiave: 'castone.tipo',
    unita: 'enum',
    valori: ['chiuso', 'griffe', 'nessuno'],
    default: 'griffe',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Castone',
  },
  {
    chiave: 'castone.parete',
    unita: 'mm',
    min: 0.5,
    max: 1.5,
    default: 0.8,
    fonteDefault: 'mestiere',
    descrizione: 'Parete del castone',
  },
  {
    chiave: 'castone.labbro',
    unita: 'mm',
    min: 0.3,
    max: 0.8,
    default: 0.4,
    fonteDefault: 'mestiere',
    descrizione: 'Labbro del castone chiuso',
  },
  {
    chiave: 'castone.sede',
    unita: 'frazione',
    min: 0.3,
    max: 0.6,
    default: 0.45,
    fonteDefault: 'mestiere',
    descrizione: 'Cintura della pietra sotto il bordo (frazione della sua altezza)',
  },
  {
    chiave: 'castone.altezza',
    unita: 'mm',
    default: 3.25,
    fonteDefault: 'derivato',
    derivato: (p) => altezzaCastone(p as ParametriAnello),
    descrizione: '0,9 × altezza della pietra + 0,5 (il chiuso quanto basta al padiglione)',
  },
  {
    chiave: 'pietra.taglio',
    unita: 'enum',
    valori: ['tondo'],
    default: 'tondo',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Taglio (fase 1: brillante tondo)',
  },
  {
    chiave: 'pietra.diametro',
    unita: 'mm',
    min: 1.5,
    max: 14,
    default: 5,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Diametro della pietra calibrata',
  },
  {
    chiave: 'pietra.altezza',
    unita: 'mm',
    default: 3.05,
    fonteDefault: 'derivato',
    derivato: (p) => altezzaPietra(p as ParametriAnello),
    descrizione: '0,61 × diametro (brillante)',
  },
  {
    chiave: 'griffe.numero',
    unita: 'n',
    min: 3,
    max: 8,
    default: 4,
    fonteDefault: 'mestiere',
    descrizione: 'Numero di griffe',
  },
  {
    chiave: 'griffe.diametro',
    unita: 'mm',
    min: 0.7,
    max: 1.6,
    default: 1,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro delle griffe',
  },
  {
    chiave: 'griffe.altezzaSopraCintura',
    unita: 'mm',
    min: 0.5,
    max: 1.5,
    default: 0.8,
    fonteDefault: 'mestiere',
    descrizione: 'Quanto le griffe salgono sopra la cintura',
  },
  {
    chiave: 'lega',
    unita: 'enum',
    valori: [...leghe],
    default: 'oro_18kt_giallo',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Lega',
  },
];

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteAnello =>
  varianti.includes(opzioni?.variante as VarianteAnello) ? (opzioni!.variante as VarianteAnello) : 'griffe';

const predefiniti = (variante?: string): ParametriAnello => {
  const tipo = varianteDi({ variante });
  return predefinitiDaParametri<ParametriAnello>(parametri, { 'castone.tipo': tipo === 'fascia' ? 'nessuno' : tipo });
};

const vincoli = (p: ParametriAnello): Array<{ chiave: string; messaggio: string }> => {
  const violati: Array<{ chiave: string; messaggio: string }> = [];
  const [minimo, massimo] = intervalliTaglia[p.taglia.sistema];
  if (p.taglia.valore < minimo || p.taglia.valore > massimo) {
    violati.push({ chiave: 'taglia.valore', messaggio: `La taglia ${p.taglia.sistema} va da ${minimo} a ${massimo}.` });
  }
  if (p.gambo.spessore > p.gambo.larghezza * 1.5) {
    violati.push({ chiave: 'gambo.spessore', messaggio: 'Gambo più spesso di 1,5 volte la larghezza.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriAnello => {
  const variante = opzioni?.variante === undefined ? undefined : varianteDi(opzioni);
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(variante));
  if (variante) {
    p.castone.tipo = variante === 'fascia' ? 'nessuno' : variante;
  }
  const [minimo, massimo] = intervalliTaglia[p.taglia.sistema];
  p.taglia.valore = limita(p.taglia.valore, minimo, massimo);
  p.gambo.spessore = Math.min(p.gambo.spessore, p.gambo.larghezza * 1.5);
  return p;
};

/** Il profilo del gambo su XY: x = radiale (piatto interno a x = 0), y = lungo il dito. */
function profiloGambo(lib: Lib, p: ParametriAnello): Smlib.Sketch {
  const { profilo, larghezza: w, spessore: s } = p.gambo;
  const fascia = lib.Pos(s / 2, 0).mul(lib.Rectangle(s, w));
  switch (profilo) {
    case 'tondo': {
      return lib.Pos(s / 2, 0).mul(lib.Ellipse(s / 2, w / 2));
    }
    case 'piatto': {
      return lib.Pos(s / 2, 0).mul(lib.Rectangle(s, w, { fillet: Math.min(0.3, 0.45 * Math.min(s, w)) }));
    }
    case 'comfort': {
      // Comfort: bombato dentro e fuori.
      return lib
        .Pos(s / 2, 0)
        .mul(lib.Ellipse(s / 2, w / 2))
        .fuse(lib.Pos(s / 2, 0).mul(lib.Rectangle(s * 0.5, w, { fillet: Math.min(0.2, 0.2 * s) })));
    }
    case 'd': {
      return lib.Ellipse(s, (w / 2) * 1.15).intersect(fascia);
    }
    default: {
      return lib.Ellipse(s, w / 2).intersect(fascia);
    }
  }
}

function costruisciGambo(lib: Lib, p: ParametriAnello): Smlib.Part {
  const raggio = diametroDi(p) / 2;
  const profilo = profiloGambo(lib, p);
  if (p.gambo.rastremazione >= 1 - 1e-9) {
    return lib.Pos(raggio, 0).mul(profilo).revolve(lib.Y);
  }
  // Otto profili attorno al dito, scalati attorno al bordo interno: 1 in alto (+Z), rastremazione in basso.
  const sezioni = Array.from({ length: 8 }, (_, k) => {
    const angolo = k * 45;
    const fattore = 1 - (1 - p.gambo.rastremazione) * ((1 + Math.sin((angolo * Math.PI) / 180)) / 2);
    return lib.Pos(raggio, 0).mul(profilo.scale(fattore)).rotate(lib.Y, angolo);
  });
  return lib.loft(sezioni, { closed: true });
}

/** La testa (castone a griffe o chiuso) con base sul piano XY, centrata sull'asse Z. */
function costruisciTesta(lib: Lib, p: ParametriAnello): Smlib.Part | undefined {
  const rp = p.pietra.diametro / 2;
  const { parete } = p.castone;
  const altezza = altezzaCastone(p);
  const centrato = { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] as const };
  if (p.castone.tipo === 'chiuso') {
    const fondo = 0.6;
    let tubo = lib.Cylinder(rp + parete, altezza, centrato);
    tubo = tubo.cut(lib.Pos(0, 0, fondo).mul(lib.Cylinder(rp + 0.05, altezza, centrato)));
    tubo = tubo.cut(lib.Pos(0, 0, -0.5).mul(lib.Cylinder(rp - p.castone.labbro, altezza + 1, centrato)));
    tubo = normalizzaForma(lib, tubo);
    try {
      return tubo.fillet(tubo.edges().circles().top(), parete * 0.4);
    } catch {
      return tubo;
    }
  }
  if (p.castone.tipo === 'griffe') {
    const r = p.griffe.diametro / 2;
    // Galleria aperta al centro (il padiglione ci passa), alzata quanto serve perché la punta resti sopra il gambo.
    const alzata = rialzo(p);
    const base = lib
      .Cylinder(rp + parete, 1.2 + alzata, centrato)
      .cut(lib.Pos(0, 0, -0.5).mul(lib.Cylinder(Math.max(0.3, rp - 0.3), 2.2 + alzata, centrato)));
    const altezzaGriffa = cinturaTesta(p) + p.griffe.altezzaSopraCintura;
    let griffa = lib.Cylinder(r, altezzaGriffa, centrato);
    griffa = griffa.fillet(griffa.edges().top(), r * 0.9);
    const griffe = lib.PolarLocations(rp + r - 0.1, p.griffe.numero).mul(griffa) as Smlib.Part[];
    return base.fuse(...griffe);
  }
  return undefined;
}

/** Un brillante tondo: cintura, corona (tronco di cono) e padiglione (cono), con la cintura a z = 0. */
function costruisciPietra(lib: Lib, p: ParametriAnello): Smlib.Part {
  const d = p.pietra.diametro;
  const rp = d / 2;
  const cintura = lib.Cylinder(rp, 0.03 * d, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] });
  const corona = lib
    .Cone(rp, rp * 0.55, 0.16 * d, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] })
    .translate(0, 0, 0.03 * d);
  const padiglione = lib.Cone(0.02, rp, 0.43 * d, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX] });
  return cintura.fuse(corona, padiglione);
}

/** Quota della base della testa: 0,5 mm dentro il gambo, in alto. */
const quotaTesta = (p: ParametriAnello): number => diametroDi(p) / 2 + p.gambo.spessore - 0.5;

/**
 * Rialzo della galleria a griffe: la punta del padiglione (0,43 × diametro sotto la cintura) deve stare 0,2 mm sopra
 * il gambo, che la testa compenetra di 0,5 mm (per un brillante di 5 mm: ≈ 1 mm).
 */
function rialzo(p: ParametriAnello): number {
  return p.castone.tipo === 'griffe' ? Math.max(0, 0.5 + 0.2 - quotaCintura(p) + 0.43 * p.pietra.diametro) : 0;
}

/** Quota della cintura della pietra sopra la base della testa. */
const cinturaTesta = (p: ParametriAnello): number => rialzo(p) + quotaCintura(p);

function costruisciConEsiti(lib: Lib, p: ParametriAnello): RisultatoCostruzione {
  const esiti: Esito[] = [];
  const pezzi: PezzoFamiglia[] = [];
  try {
    let anello = misuraPezzo('Gambo', () => costruisciGambo(lib, p));
    const testa = misuraPezzo('Testa', () => costruisciTesta(lib, p));
    if (testa) {
      anello = anello.fuse(testa.translate(0, 0, quotaTesta(p)));
    }
    anello = normalizzaForma(lib, anello);
    if (!anello.isValid()) {
      esiti.push(
        esito('blocco', 'SOLIDO_NON_VALIDO', { messaggio: 'L’anello non è un solido valido.', pezzo: 'Anello' }),
      );
    }
    pezzi.push({ name: 'Anello', shape: anello, ruolo: 'metallo', materiale: p.lega, ...aspettoMateriale(p.lega) });
    if (testa) {
      const pietra = misuraPezzo('Pietra', () => costruisciPietra(lib, p)).translate(
        0,
        0,
        quotaTesta(p) + cinturaTesta(p),
      );
      // La pietra non entra nel peso del metallo: senza densità.
      pezzi.push({
        name: 'Pietra',
        shape: normalizzaForma(lib, pietra),
        ruolo: 'pietra',
        materiale: 'diamante',
        color: aspettoMateriale('diamante').color,
        metalness: 0,
        roughness: aspettoMateriale('diamante').roughness,
      });
    }
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', {
        messaggio: `Anello non costruito: ${(error as Error).message}`,
        pezzo: 'Anello',
      }),
    );
  }
  return { pezzi, esiti };
}

// oxlint-disable-next-line eslint/max-params -- firma del contratto delle famiglie (§1.0): lib, pezzi, parametri, processo, opzioni.
function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriAnello,
  processo: Processo = 'fusione_cera_persa',
): Esito[] {
  const esiti: Esito[] = [];
  const soglia = sogliaParete(processo, p.lega);
  const gamboMinimo = p.gambo.spessore * p.gambo.rastremazione;
  esiti.push(
    esitoMinimo('PARETE_MIN', {
      valore: Math.min(gamboMinimo, p.castone.tipo === 'nessuno' ? Number.POSITIVE_INFINITY : p.castone.parete),
      soglia,
      cosa: `Parete minima (${materiale(p.lega).nome})`,
      pezzo: 'Anello',
    }),
  );
  esiti.push(
    esitoMinimo('GAMBO_MIN', {
      valore: gamboMinimo,
      soglia: 1.2,
      cosa: 'Spessore del gambo in basso',
      pezzo: 'Anello',
      fattoreBlocco: 0,
    }),
  );
  if (p.castone.tipo === 'griffe') {
    esiti.push(
      esitoMinimo('GRIFFA_BASE', {
        valore: p.griffe.diametro,
        soglia: 0.7,
        cosa: 'Diametro delle griffe',
        pezzo: 'Anello',
      }),
    );
  }
  if (p.castone.tipo !== 'nessuno') {
    // Punta del padiglione rispetto alla base del castone (negativa = sotto).
    const punta = cinturaTesta(p) - 0.43 * p.pietra.diametro;
    const anello = pezzi.find((pezzo) => pezzo.ruolo === 'metallo')?.shape;
    if (p.castone.tipo === 'chiuso') {
      esiti.push(
        punta >= 0
          ? esito('ok', 'PIETRA_BUCA_FONDO', {
              messaggio: 'Il padiglione resta dentro il castone chiuso.',
              valore: punta,
            })
          : esito('blocco', 'PIETRA_BUCA_FONDO', {
              messaggio: `Il padiglione esce di ${mm(-punta)} sotto il castone chiuso.`,
              valore: punta,
            }),
      );
    } else if (anello instanceof lib.Part) {
      const tocca = anello.contains([0, 0, quotaTesta(p) + punta]);
      esiti.push(
        tocca
          ? esito('avviso', 'PIETRA_BUCA_FONDO', {
              messaggio: 'La punta del padiglione entra nel gambo: alzare il castone o forare il gambo.',
              valore: punta,
            })
          : esito('ok', 'PIETRA_BUCA_FONDO', { messaggio: 'La punta del padiglione resta libera.', valore: punta }),
      );
    }
  }
  const { ritiro } = soglieProcessi[processo];
  if (ritiro) {
    esiti.push(esito('info', 'RITIRO', `Ritiro della cera ${ritiro[0]}–${ritiro[1]} %: dichiarato, non applicato.`));
  }
  const nomi: Record<SistemaTaglia, string> = { it: 'IT', us: 'US', eu_iso: 'ISO', diametro: '⌀' };
  esiti.push(
    esito('info', 'TAGLIA', {
      messaggio: `Taglia ${nomi[p.taglia.sistema]} ${p.taglia.valore} = ⌀ ${mm(diametroDi(p))} interno.`,
      valore: diametroDi(p),
    }),
  );
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

/**
 * La famiglia anello.
 * @public
 */
export const anello: Famiglia<ParametriAnello> = {
  id: 'anello',
  versione: 1,
  varianti,
  partTypes: [],
  schema: schemaDaParametri<ParametriAnello>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  viste: {
    principale: 'tre_quarti_pietra',
    facce: [
      f(
        'tre_quarti_pietra',
        35,
        35,
        'three-quarter view on the stone, from a bit above and to one side: the usual jewellery product photo',
      ),
      f(
        'asse_dito',
        0,
        0,
        'along the finger axis: the ring as a circle, stone at the top (shank thickness, setting height)',
      ),
      f('fianco_esterno', 90, 0, 'pure side profile (shank width)'),
      f('sopra', 0, 90, 'straight above the stone (table, shank width)'),
    ],
    nomi: {
      fronte: { faccia: 'asse_dito', azimuth: 0, elevation: 0 },
      tre_quarti: { faccia: 'tre_quarti_pietra', azimuth: 0, elevation: 0 },
      lato: { faccia: 'fianco_esterno', azimuth: 0, elevation: 0 },
      alto: { faccia: 'sopra', azimuth: 0, elevation: 0 },
    },
  },
  silhouette: { assi: ['x', 'y', 'z'], simmetrie: ['yz', 'xz'] },
  materialiAmmessi: [...leghe],
  emettiMain: (p, ipotesi, opzioni) =>
    emettiMainFamiglia(
      {
        id: 'anello',
        versione: 1,
        variante: varianteDi(opzioni ?? { variante: p.castone.tipo === 'nessuno' ? 'fascia' : p.castone.tipo }),
      },
      p,
      ipotesi,
    ),
};
