/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
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
import { normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaParete, soglieProcessi } from '#famiglie/processi.js';
import { esitiPezzi, esito, esitoMinimo, normalizzaForma } from '#famiglie/verifiche-comuni.js';

/**
 * Famiglia `pendente` (charm, specifica §1.8): disco, cuore, goccia o placchetta su XY con la faccia a vista +Z,
 * bombata a calotta, anellino in piano o di traverso in alto (0,4 mm dentro il corpo) e foro facoltativo con ponte
 * di 1,2 mm. Fusione a cera persa. Le forme `lettera` e `contorno` e la pietra restano fuori dalla fase 1.
 */

type Lib = typeof Smlib;

export type VariantePendente = 'disco' | 'cuore' | 'goccia' | 'placchetta';

const leghe = [
  'argento_925',
  'oro_18kt_giallo',
  'oro_18kt_rosa',
  'oro_18kt_bianco',
  'oro_14kt',
  'oro_9kt',
  'ottone',
] as const;

export type ParametriPendente = {
  corpo: { forma: VariantePendente; lunghezza: number; larghezza: number; spessore: number; bombatura: number };
  anellino: { diametroInterno: number; filo: number; orientamento: 'in_piano' | 'di_traverso' };
  occhiello: { foro: number };
  lega: (typeof leghe)[number];
};

const varianti = ['disco', 'cuore', 'goccia', 'placchetta'] as const;

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'corpo.forma',
    unita: 'enum',
    valori: [...varianti],
    default: 'disco',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Forma del pendente',
  },
  {
    chiave: 'corpo.lunghezza',
    unita: 'mm',
    min: 5,
    max: 60,
    default: 15,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Altezza del pendente (senza anellino)',
  },
  {
    chiave: 'corpo.larghezza',
    unita: 'mm',
    min: 5,
    max: 60,
    default: 15,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Larghezza',
  },
  {
    chiave: 'corpo.spessore',
    unita: 'mm',
    min: 0.8,
    max: 3,
    default: 1.2,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore al bordo',
  },
  {
    chiave: 'corpo.bombatura',
    unita: 'mm',
    min: 0,
    max: 3,
    default: 0.6,
    fonteDefault: 'mestiere',
    descrizione: 'Bombatura della faccia a vista',
  },
  {
    chiave: 'anellino.diametroInterno',
    unita: 'mm',
    min: 2,
    max: 6,
    default: 3,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro interno dell’anellino',
  },
  {
    chiave: 'anellino.filo',
    unita: 'mm',
    min: 0.6,
    max: 1.5,
    default: 0.9,
    fonteDefault: 'mestiere',
    descrizione: 'Filo dell’anellino',
  },
  {
    chiave: 'anellino.orientamento',
    unita: 'enum',
    valori: ['in_piano', 'di_traverso'],
    default: 'in_piano',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Anellino nel piano del pendente (0°) o di traverso (90°)',
  },
  {
    chiave: 'occhiello.foro',
    unita: 'mm',
    min: 0,
    max: 3,
    default: 0,
    fonteDefault: 'scelta_nostra',
    descrizione: 'Foro sotto l’anellino (0 = nessuno, 1–3)',
  },
  {
    chiave: 'lega',
    unita: 'enum',
    valori: [...leghe],
    default: 'argento_925',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Lega',
  },
];

const varianteDi = (opzioni?: OpzioniFamiglia): VariantePendente =>
  varianti.includes(opzioni?.variante as VariantePendente) ? (opzioni!.variante as VariantePendente) : 'disco';

const predefiniti = (variante?: string): ParametriPendente =>
  predefinitiDaParametri<ParametriPendente>(parametri, {
    'corpo.forma': varianteDi({ variante }),
    ...(variante === 'goccia' ? { 'corpo.larghezza': 10 } : {}),
  });

const vincoli = (p: ParametriPendente): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
  if (p.occhiello.foro > 0 && p.occhiello.foro < 1) {
    violati.push({ chiave: 'occhiello.foro', messaggio: 'Il foro va da 1 a 3 mm (0 = nessuno).' });
  }
  if (p.occhiello.foro + 2.4 > Math.min(p.corpo.lunghezza, p.corpo.larghezza) / 2) {
    violati.push({ chiave: 'occhiello.foro', messaggio: 'Il foro non lascia ponte e bordo nel pendente.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriPendente => {
  const variante = opzioni?.variante === undefined ? undefined : varianteDi(opzioni);
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(variante));
  if (variante) {
    p.corpo.forma = variante;
  }
  const { occhiello, corpo } = p;
  occhiello.foro =
    occhiello.foro > 0
      ? Math.min(Math.max(1, occhiello.foro), Math.min(corpo.lunghezza, corpo.larghezza) / 2 - 2.4)
      : 0;
  occhiello.foro = Math.max(0, occhiello.foro);
  return p;
};

/** Raggio e centro dei lobi del cuore: si sovrappongono (centri a 0,8 r dall'asse), larghezza totale = larghezza. */
const lobi = (larghezza: number): { raggio: number; scarto: number } => ({
  raggio: larghezza / 3.6,
  scarto: (0.8 * larghezza) / 3.6,
});

/** La sagoma (XY, ingombro centrato) e la quota del suo bordo alto sull'asse (dove si attacca l'anellino). */
function sagoma(lib: Lib, p: ParametriPendente): { schizzo: Smlib.Sketch; cima: number } {
  const { forma, lunghezza: l, larghezza: w } = p.corpo;
  if (forma === 'placchetta') {
    return { schizzo: lib.Rectangle(w, l, { fillet: Math.min(1, 0.2 * Math.min(w, l)) }), cima: l / 2 };
  }
  if (forma === 'goccia') {
    const punta = Math.max(0.3, 0.08 * w);
    return {
      schizzo: lib.Hull(
        lib.Pos(0, -l / 2 + w / 2).mul(lib.Circle(w / 2)),
        lib.Pos(0, l / 2 - punta).mul(lib.Circle(punta)),
      ),
      cima: l / 2,
    };
  }
  if (forma === 'cuore') {
    const { raggio, scarto } = lobi(w);
    const centro = l / 2 - raggio;
    const punta = lib.Pos(0, -l / 2 + 0.05).mul(lib.Circle(0.05));
    const sinistro = lib.Hull(lib.Pos(-scarto, centro).mul(lib.Circle(raggio)), punta);
    const destro = lib.Hull(lib.Pos(scarto, centro).mul(lib.Circle(raggio)), punta);
    return { schizzo: sinistro.fuse(destro), cima: centro + Math.sqrt(raggio ** 2 - scarto ** 2) };
  }
  return { schizzo: Math.abs(w - l) < 1e-9 ? lib.Circle(l / 2) : lib.Ellipse(w / 2, l / 2), cima: l / 2 };
}

function costruisciConEsiti(lib: Lib, p: ParametriPendente): RisultatoCostruzione {
  const esiti: Esito[] = [];
  try {
    const { corpo: c, anellino: a } = p;
    const { schizzo, cima } = sagoma(lib, p);
    let corpo = schizzo.extrude(c.spessore + c.bombatura);
    if (c.bombatura > 0) {
      const corda = Math.max(c.lunghezza, c.larghezza);
      const raggio = (corda ** 2 / 4 + c.bombatura ** 2) / (2 * c.bombatura);
      corpo = corpo.intersect(lib.Pos(0, 0, c.spessore + c.bombatura - raggio).mul(lib.Sphere(raggio)));
    }
    // Anellino: toro di filo, 0,4 mm dentro il corpo sull'asse.
    const raggioMedio = a.diametroInterno / 2 + a.filo / 2;
    const toro = lib.Torus(raggioMedio, a.filo / 2, { align: null });
    const posato = a.orientamento === 'di_traverso' ? lib.Rot(0, 90, 0).mul(toro) : toro;
    corpo = corpo.fuse(lib.Pos(0, cima - 0.4 + a.diametroInterno / 2 + a.filo, c.spessore / 2).mul(posato));
    if (p.occhiello.foro > 0) {
      const y = cima - p.occhiello.foro / 2 - 1.2;
      corpo = corpo.cut(
        lib.Pos(0, y, -1).mul(
          lib.Cylinder(p.occhiello.foro / 2, c.spessore + c.bombatura + 2, {
            align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN],
          }),
        ),
      );
    }
    const forma = normalizzaForma(lib, corpo);
    if (!forma.isValid()) {
      esiti.push(esito('blocco', 'SOLIDO_NON_VALIDO', 'Il pendente non è un solido valido.', { pezzo: 'Pendente' }));
    }
    return {
      pezzi: [{ name: 'Pendente', shape: forma, ruolo: 'metallo', materiale: p.lega, ...aspettoMateriale(p.lega) }],
      esiti,
    };
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Pendente non costruito: ${(error as Error).message}`, {
        pezzo: 'Pendente',
      }),
    );
    return { pezzi: [], esiti };
  }
}

function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriPendente,
  processo: Processo = 'fusione_cera_persa',
): Esito[] {
  const esiti: Esito[] = [];
  esiti.push(
    esitoMinimo(
      'PARETE_MIN',
      p.corpo.spessore,
      sogliaParete(processo, p.lega),
      `Spessore al bordo (${materiale(p.lega).nome})`,
      { pezzo: 'Pendente' },
    ),
  );
  esiti.push(esitoMinimo('FILO_ANELLINO', p.anellino.filo, 0.6, 'Filo dell’anellino', { pezzo: 'Pendente' }));
  if (p.occhiello.foro > 0) {
    esiti.push(esitoMinimo('PONTE_OCCHIELLO', 1.2, 0.8, 'Ponte sopra il foro', { pezzo: 'Pendente' }));
  }
  const ritiro = soglieProcessi[processo].ritiro;
  if (ritiro) {
    esiti.push(esito('info', 'RITIRO', `Ritiro della cera ${ritiro[0]}–${ritiro[1]} %: dichiarato, non applicato.`));
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

export const pendente: Famiglia<ParametriPendente> = {
  id: 'pendente',
  versione: 1,
  varianti,
  partTypes: [],
  schema: schemaDaParametri<ParametriPendente>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['z'], simmetrie: ['yz'] },
  materialiAmmessi: [...leghe],
  emettiMain: (p, ipotesi, opzioni) =>
    emettiMainFamiglia('pendente', 1, varianteDi(opzioni ?? { variante: p.corpo.forma }), p, ipotesi),
};
