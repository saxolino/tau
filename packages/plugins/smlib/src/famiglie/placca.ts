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
import { aspettoMateriale } from '#famiglie/materiali.js';
import { normalizzaConParametri, predefinitiDaParametri, radianti, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaParete, sogliaSformo } from '#famiglie/processi.js';
import {
  esitiPezzi,
  esitiSformo,
  esito,
  esitoMinimo,
  mm,
  normalizzaForma,
  sformoDuePiani,
} from '#famiglie/verifiche-comuni.js';

/**
 * Famiglia `placca` (specifica §1.5): piastra su XY con la faccia a vista +Z, testo centrato in rilievo o inciso,
 * bordo in rilievo, perni o fori di fissaggio sotto.
 *
 * In pressofusione la piastra e il bordo sono sformati nell'estrusione (piano di divisione sul retro, z = 0) e i
 * perni sono coni. Il testo no: `extrude` con `taper` rifiuta le lettere Lato con spigoli collineari (H, T, 1…) e
 * costa ≈ 270 ms quando riesce (esiti T-D1-02), quindi le lettere hanno i fianchi dritti e la verifica lo dice.
 */

type Lib = typeof Smlib;

export type VariantePlacca = 'rettangolo' | 'ovale' | 'cerchio' | 'scudo';

export type ParametriPlacca = {
  piastra: {
    forma: VariantePlacca;
    lunghezza: number;
    larghezza: number;
    spessore: number;
    raggioAngoli: number;
    bombatura: number;
  };
  bordo: { rilievo: number; larghezza: number };
  testo: {
    contenuto: string;
    altezza: number;
    modo: 'rilievo' | 'inciso' | 'nessuno';
    profondita: number;
    font: 'lato' | 'sinopia';
  };
  fissaggio: { tipo: 'nessuno' | 'perni' | 'fori' | 'ribattini'; perno: { diametro: number; lunghezza: number } };
  costruzione: {
    processo: 'pressofusione_zama' | 'tranciatura_lamiera' | 'fusione_cera_persa';
    materiale: 'zama' | 'ottone' | 'argento_925' | 'inox';
    sformo: number;
  };
};

const varianti = ['rettangolo', 'ovale', 'cerchio', 'scudo'] as const;

/** Larghezza del tratto più sottile di Lato Regular rispetto all'altezza delle maiuscole (traversa della H). */
export const TRATTO_LATO = 0.099;

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'piastra.forma',
    unita: 'enum',
    valori: [...varianti],
    default: 'rettangolo',
    fonteDefault: 'mestiere',
    descrizione: 'Forma della piastra',
  },
  {
    chiave: 'piastra.lunghezza',
    unita: 'mm',
    min: 6,
    max: 120,
    default: 30,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Lunghezza (diametro per il cerchio)',
  },
  {
    chiave: 'piastra.larghezza',
    unita: 'mm',
    min: 4,
    max: 60,
    default: 12,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza',
  },
  {
    chiave: 'piastra.spessore',
    unita: 'mm',
    min: 0.6,
    max: 5,
    default: 1.5,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore (zama 1,5 · ottone tranciato 0,8)',
  },
  {
    chiave: 'piastra.raggioAngoli',
    unita: 'mm',
    min: 0,
    max: 20,
    default: 2,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Raggio degli angoli',
  },
  {
    chiave: 'piastra.bombatura',
    unita: 'mm',
    min: 0,
    max: 4,
    default: 0,
    fonteDefault: 'scelta_nostra',
    descrizione: 'Bombatura della faccia a vista',
  },
  {
    chiave: 'bordo.rilievo',
    unita: 'mm',
    min: 0,
    max: 1,
    default: 0.3,
    fonteDefault: 'mestiere',
    descrizione: 'Rilievo del bordo (0 = senza)',
  },
  {
    chiave: 'bordo.larghezza',
    unita: 'mm',
    min: 0.4,
    max: 3,
    default: 0.8,
    fonteDefault: 'mestiere',
    descrizione: 'Larghezza del bordo',
  },
  {
    chiave: 'testo.contenuto',
    unita: 'testo',
    lunghezzaMassima: 24,
    default: '',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Testo del logo',
  },
  {
    chiave: 'testo.altezza',
    unita: 'mm',
    min: 2,
    max: 40,
    default: 5,
    fonteDefault: 'mestiere',
    descrizione: 'Altezza delle maiuscole',
  },
  {
    chiave: 'testo.modo',
    unita: 'enum',
    valori: ['rilievo', 'inciso', 'nessuno'],
    default: 'rilievo',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Testo in rilievo o inciso',
  },
  {
    chiave: 'testo.profondita',
    unita: 'mm',
    min: 0.2,
    max: 1.5,
    default: 0.4,
    fonteDefault: 'mestiere',
    descrizione: 'Rilievo o profondità del testo',
  },
  {
    chiave: 'testo.font',
    unita: 'enum',
    valori: ['lato', 'sinopia'],
    default: 'lato',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Carattere',
  },
  {
    chiave: 'fissaggio.tipo',
    unita: 'enum',
    valori: ['nessuno', 'perni', 'fori', 'ribattini'],
    default: 'perni',
    fonteDefault: 'mestiere',
    descrizione: 'Fissaggio',
  },
  {
    chiave: 'fissaggio.perno.diametro',
    unita: 'mm',
    min: 1,
    max: 3,
    default: 1.5,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro dei perni o dei fori',
  },
  {
    chiave: 'fissaggio.perno.lunghezza',
    unita: 'mm',
    min: 2,
    max: 8,
    default: 4,
    fonteDefault: 'mestiere',
    descrizione: 'Lunghezza dei perni',
  },
  {
    chiave: 'fissaggio.interasse',
    unita: 'mm',
    default: 18,
    fonteDefault: 'derivato',
    derivato: (p) => 0.6 * (p as ParametriPlacca).piastra.lunghezza,
    descrizione: 'Interasse dei perni: 0,6 × lunghezza',
  },
  {
    chiave: 'costruzione.processo',
    unita: 'enum',
    valori: ['pressofusione_zama', 'tranciatura_lamiera', 'fusione_cera_persa'],
    default: 'pressofusione_zama',
    fonteDefault: 'mestiere',
    descrizione: 'Processo produttivo',
  },
  {
    chiave: 'costruzione.materiale',
    unita: 'enum',
    valori: ['zama', 'ottone', 'argento_925', 'inox'],
    default: 'zama',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale',
  },
  {
    chiave: 'costruzione.sformo',
    unita: 'deg',
    min: 0.5,
    max: 2,
    default: 1,
    fonteDefault: 'mestiere',
    descrizione: 'Sformo dei fianchi in pressofusione',
  },
];

const varianteDi = (opzioni?: OpzioniFamiglia): VariantePlacca =>
  varianti.includes(opzioni?.variante as VariantePlacca) ? (opzioni!.variante as VariantePlacca) : 'rettangolo';

const predefiniti = (variante?: string): ParametriPlacca =>
  predefinitiDaParametri<ParametriPlacca>(parametri, { 'piastra.forma': varianteDi({ variante }) });

const materialiDelProcesso: Readonly<
  Record<ParametriPlacca['costruzione']['processo'], readonly ParametriPlacca['costruzione']['materiale'][]>
> = {
  pressofusione_zama: ['zama'],
  tranciatura_lamiera: ['ottone', 'inox'],
  fusione_cera_persa: ['ottone', 'argento_925'],
};

const vincoli = (p: ParametriPlacca): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
  if (!materialiDelProcesso[p.costruzione.processo].includes(p.costruzione.materiale)) {
    violati.push({ chiave: 'costruzione.materiale', messaggio: 'Materiale non adatto al processo.' });
  }
  if (p.testo.modo === 'inciso' && p.testo.profondita > p.piastra.spessore * 0.6) {
    violati.push({ chiave: 'testo.profondita', messaggio: 'L’incisione supera il 60 % dello spessore.' });
  }
  if (p.bordo.larghezza * 2 >= Math.min(p.piastra.lunghezza, p.piastra.larghezza)) {
    violati.push({ chiave: 'bordo.larghezza', messaggio: 'Il bordo chiude la piastra.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriPlacca => {
  const variante = opzioni?.variante === undefined ? undefined : varianteDi(opzioni);
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(variante));
  if (variante) {
    p.piastra.forma = variante;
  }
  if (p.piastra.forma === 'cerchio') {
    p.piastra.larghezza = Math.min(60, p.piastra.lunghezza);
  }
  if (!materialiDelProcesso[p.costruzione.processo].includes(p.costruzione.materiale)) {
    p.costruzione.materiale = materialiDelProcesso[p.costruzione.processo][0]!;
  }
  p.testo.profondita =
    p.testo.modo === 'inciso' ? Math.min(p.testo.profondita, p.piastra.spessore * 0.6) : p.testo.profondita;
  p.bordo.larghezza = Math.min(p.bordo.larghezza, Math.min(p.piastra.lunghezza, p.piastra.larghezza) / 2 - 0.5);
  return p;
};

/** Il contorno della piastra (schizzo su XY, centrato). */
function sagoma(lib: Lib, p: ParametriPlacca): Smlib.Sketch {
  const { forma, lunghezza, larghezza, raggioAngoli } = p.piastra;
  const r = Math.min(raggioAngoli, 0.49 * Math.min(lunghezza, larghezza));
  if (forma === 'ovale') {
    return lib.Ellipse(lunghezza / 2, larghezza / 2);
  }
  if (forma === 'cerchio') {
    return lib.Circle(lunghezza / 2);
  }
  if (forma === 'scudo') {
    const tallone = Math.min(lunghezza, larghezza) / 2;
    const scudo = lib.Hull(
      lib.Rectangle(lunghezza, larghezza / 2).translate(0, larghezza / 4),
      lib.Pos(0, -larghezza / 2 + tallone).mul(lib.Circle(tallone)),
    );
    return r > 0.05
      ? scudo.fillet(r, [
          [-lunghezza / 2, larghezza / 2],
          [lunghezza / 2, larghezza / 2],
        ])
      : scudo;
  }
  return lib.Rectangle(lunghezza, larghezza, r > 0.05 ? { fillet: r } : {});
}

/**
 * Il contorno ristretto di `distanza`: offset per rettangolo e scudo; ellisse e cerchio a semiassi ridotti
 * (`Sketch.offset` di un'ellisse rifiuta le distanze piccole: «removes the whole region» a 0,026 mm).
 */
function sagomaRistretta(lib: Lib, p: ParametriPlacca, sagomaPiena: Smlib.Sketch, distanza: number): Smlib.Sketch {
  if (distanza <= 0) {
    return sagomaPiena;
  }
  const { forma, lunghezza, larghezza } = p.piastra;
  if (forma === 'ovale') {
    // L'ellisse a semiassi ridotti sporge di poco dall'offset vero fra i vertici: un margine la tiene dentro.
    const margine = 0.2 * distanza + 0.005;
    return lib.Ellipse(lunghezza / 2 - distanza - margine, larghezza / 2 - distanza - margine);
  }
  if (forma === 'cerchio') {
    return lib.Circle(lunghezza / 2 - distanza);
  }
  return sagomaPiena.offset(-distanza, { corners: 'round' });
}

/** Il testo ridotto finché sta nello spazio dentro il bordo (passi del 10 %), con l'altezza effettiva. */
function testoChesta(
  lib: Lib,
  p: ParametriPlacca,
  spazio: Smlib.Sketch,
): { testo: Smlib.Sketch; altezza: number } | undefined {
  const contenuto = p.testo.contenuto.trim();
  if (p.testo.modo === 'nessuno' || contenuto.length === 0) {
    return undefined;
  }
  const testo = lib.Text(contenuto, p.testo.altezza);
  const { size, center } = testo.bbox();
  let fattore = Math.min(1, spazio.bbox().size.x / size.x, spazio.bbox().size.y / size.y);
  for (let tentativo = 0; tentativo < 12; tentativo++) {
    const riquadro = lib
      .Pos(center.x * fattore, center.y * fattore)
      .mul(lib.Rectangle(size.x * fattore, size.y * fattore));
    if (spazio.intersect(riquadro).area >= riquadro.area * (1 - 1e-6)) {
      break;
    }
    fattore *= 0.9;
  }
  return { testo: fattore < 1 ? testo.scale(fattore) : testo, altezza: p.testo.altezza * fattore };
}

/** Pezzo e altezza effettiva del testo (per le verifiche). */
const altezzeTesto = new WeakMap<object, number>();

function costruisciPlacca(lib: Lib, p: ParametriPlacca, esiti: Esito[]): Smlib.Part {
  const { piastra, bordo, testo, fissaggio, costruzione } = p;
  const zama = costruzione.processo === 'pressofusione_zama';
  const sformo = zama ? costruzione.sformo : 0;
  const base = sagoma(lib, p);
  const bombata = piastra.bombatura > 0;
  const altezzaPiastra = piastra.spessore + piastra.bombatura;
  let corpo = base.extrude(altezzaPiastra, sformo > 0 ? { taper: sformo } : {});
  // Calotta: sfera di corda = lunghezza e freccia = bombatura, appoggiata allo spessore sul bordo.
  const raggioCalotta = bombata ? (piastra.lunghezza ** 2 / 4 + piastra.bombatura ** 2) / (2 * piastra.bombatura) : 0;
  const centroCalotta = piastra.spessore + piastra.bombatura - raggioCalotta;
  const calotta = (scarto: number): Smlib.Part => lib.Pos(0, 0, centroCalotta).mul(lib.Sphere(raggioCalotta + scarto));
  if (bombata) {
    corpo = corpo.intersect(calotta(0));
  }
  const ritiroCima = sformo > 0 ? piastra.spessore * Math.tan(radianti(sformo)) : 0;
  const cima = sagomaRistretta(lib, p, base, ritiroCima);
  const rilievi: Smlib.Part[] = [];
  if (bordo.rilievo > 0) {
    const cornice = cima.cut(sagomaRistretta(lib, p, base, ritiroCima + bordo.larghezza));
    let solido = lib
      .Pos(0, 0, piastra.spessore - 0.05)
      .mul(cornice)
      .extrude(bordo.rilievo + 0.05 + piastra.bombatura, sformo > 0 ? { taper: sformo } : {});
    if (bombata) {
      solido = solido.intersect(calotta(bordo.rilievo));
    }
    rilievi.push(solido);
  }
  const spazio = sagomaRistretta(lib, p, base, ritiroCima + (bordo.rilievo > 0 ? bordo.larghezza + 0.5 : 0.5));
  const scritta = testoChesta(lib, p, spazio);
  let inciso: Smlib.Part | undefined;
  if (scritta) {
    if (scritta.altezza < testo.altezza - 1e-9) {
      esiti.push(
        esito(
          'avviso',
          'TESTO_RIDOTTO',
          `Testo ridotto a ${mm(scritta.altezza, 1)} di altezza perché stia nella piastra.`,
          {
            valore: scritta.altezza,
            soglia: testo.altezza,
          },
        ),
      );
    }
    if (testo.font === 'sinopia') {
      esiti.push(esito('avviso', 'FONT', 'Il carattere Sinopia non è ancora nel CAD: testo in Lato.'));
    }
    if (testo.modo === 'rilievo') {
      let solido = lib
        .Pos(0, 0, piastra.spessore - 0.05)
        .mul(scritta.testo)
        .extrude(testo.profondita + 0.05 + (bombata ? piastra.bombatura + 0.1 : 0));
      if (bombata) {
        solido = solido.intersect(calotta(testo.profondita));
      }
      rilievi.push(solido);
    } else {
      inciso = lib
        .Pos(0, 0, piastra.spessore - testo.profondita - (bombata ? 0.5 : 0))
        .mul(scritta.testo)
        .extrude(testo.profondita + 0.05 + (bombata ? piastra.bombatura + 1.5 : 0));
      if (bombata) {
        inciso = inciso.cut(calotta(-testo.profondita));
      }
    }
  }
  const interasse = 0.6 * piastra.lunghezza;
  const posizioni: [number, number][] = [
    [-interasse / 2, 0],
    [interasse / 2, 0],
  ];
  if (fissaggio.tipo === 'perni') {
    const r = fissaggio.perno.diametro / 2;
    const lunghezza = fissaggio.perno.lunghezza;
    // Lo sformo vale su tutta l'altezza del cono, compresi gli 0,5 mm dentro la piastra.
    const punta = zama ? Math.max(0.3, r - (lunghezza + 0.5) * Math.tan(radianti(sformo))) : r;
    for (const [x, y] of posizioni) {
      const perno = zama
        ? lib.Cone(punta, r, lunghezza + 0.5, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX] })
        : lib.Cylinder(r, lunghezza + 0.5, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MAX] });
      rilievi.push(lib.Pos(x, y, 0.5).mul(perno));
    }
  }
  if (rilievi.length > 0) {
    corpo = corpo.fuse(...rilievi);
  }
  const fori: Smlib.Part[] = inciso ? [inciso] : [];
  if (fissaggio.tipo === 'fori' || fissaggio.tipo === 'ribattini') {
    for (const [x, y] of posizioni) {
      fori.push(
        lib.Pos(x, y, -1).mul(
          lib.Cylinder(fissaggio.perno.diametro / 2, altezzaPiastra + 3, {
            align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN],
          }),
        ),
      );
    }
    if (fissaggio.tipo === 'ribattini') {
      esiti.push(
        esito('info', 'RIBATTINI', 'Fori per ribattini: i ribattini si scelgono a catalogo, non sono modellati.'),
      );
    }
  }
  if (fori.length > 0) {
    corpo = corpo.cut(...fori);
  }
  const normalizzata = normalizzaForma(lib, corpo);
  if (scritta) {
    altezzeTesto.set(normalizzata, scritta.altezza);
  }
  if (!normalizzata.isValid()) {
    esiti.push(esito('blocco', 'SOLIDO_NON_VALIDO', 'La placca non è un solido valido.', { pezzo: 'Placca' }));
  }
  return normalizzata;
}

function costruisciConEsiti(lib: Lib, p: ParametriPlacca): RisultatoCostruzione {
  const esiti: Esito[] = [];
  try {
    const forma = costruisciPlacca(lib, p, esiti);
    return {
      pezzi: [
        {
          name: 'Placca',
          shape: forma,
          ruolo: 'placca',
          materiale: p.costruzione.materiale,
          ...aspettoMateriale(p.costruzione.materiale),
        },
      ],
      esiti,
    };
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Placca non costruita: ${(error as Error).message}`, { pezzo: 'Placca' }),
    );
    return { pezzi: [], esiti };
  }
}

function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriPlacca,
  processo: Processo = p.costruzione.processo,
): Esito[] {
  const esiti: Esito[] = [];
  const placca = pezzi.find((pezzo) => pezzo.ruolo === 'placca');
  const { piastra, testo, bordo } = p;
  const altezza = placca ? altezzeTesto.get(placca.shape) : undefined;
  if (altezza !== undefined) {
    const sogliaTratto = processo === 'pressofusione_zama' ? 0.4 : 0.3;
    esiti.push(
      esitoMinimo(
        'TRATTO_MIN',
        TRATTO_LATO * altezza,
        sogliaTratto,
        `Tratto più sottile del testo (${mm(altezza, 1)} di altezza)`,
        {
          pezzo: 'Placca',
        },
      ),
    );
  }
  const sogliaPiastra =
    processo === 'pressofusione_zama'
      ? 1
      : processo === 'tranciatura_lamiera'
        ? 0.6
        : sogliaParete(processo, p.costruzione.materiale);
  const parete =
    testo.modo === 'inciso' && altezza !== undefined ? piastra.spessore - testo.profondita : piastra.spessore;
  esiti.push(
    esitoMinimo(
      'PARETE_MIN',
      parete,
      sogliaPiastra,
      testo.modo === 'inciso' ? 'Spessore sotto l’incisione' : 'Spessore della piastra',
      { pezzo: 'Placca' },
    ),
  );
  if (bordo.rilievo > 0.6 * piastra.spessore) {
    esiti.push(
      esito('avviso', 'BORDO_RILIEVO', `Bordo di ${mm(bordo.rilievo)}: oltre il 60 % dello spessore.`, {
        valore: bordo.rilievo,
        soglia: 0.6 * piastra.spessore,
      }),
    );
  }
  const minimoSformo = sogliaSformo(processo);
  if (minimoSformo !== undefined && placca?.shape instanceof lib.Part) {
    esiti.push(
      ...esitiSformo(
        sformoDuePiani(placca.shape, 0, minimoSformo - 1e-3),
        minimoSformo,
        'Placca',
        'Placca (divisione sul retro)',
      ),
    );
    if (altezza !== undefined) {
      esiti.push(
        esito(
          'avviso',
          'SFORMO_TESTO',
          'Fianchi delle lettere a 0°: il kernel non sforma il testo; lo sformo di 1° va dato sullo stampo.',
          {
            pezzo: 'Placca',
            valore: 0,
            soglia: minimoSformo,
          },
        ),
      );
    }
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

export const placca: Famiglia<ParametriPlacca> = {
  id: 'placca',
  versione: 1,
  varianti,
  partTypes: ['ornament'],
  schema: schemaDaParametri<ParametriPlacca>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p) => costruisciConEsiti(lib, p).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['z'], simmetrie: ['yz', 'xz'] },
  materialiAmmessi: ['zama', 'ottone', 'argento_925', 'inox'],
  emettiMain: (p, ipotesi, opzioni) =>
    emettiMainFamiglia('placca', 1, varianteDi(opzioni ?? { variante: p.piastra.forma }), p, ipotesi),
};
