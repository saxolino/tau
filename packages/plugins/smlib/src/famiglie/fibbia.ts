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
import { normalizzaConParametri, predefinitiDaParametri, schemaDaParametri } from '#famiglie/parametri.js';
import { sogliaParete, sogliaSformo, soglieProcessi } from '#famiglie/processi.js';
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
 * Famiglia `fibbia` (specifica §1.3): telaio piatto su XY, faccia a vista +Z, il cinturino entra lungo −Y; la
 * barra del perno sta sul lato −Y e l'ardiglione (filo tondo) vi si avvolge attorno, oppure attorno al traversino
 * centrale nella variante `doppia` (come il pilota «Fibbia · strumenti manuali»).
 *
 * Telaio da z = 0 a z = sezioneSpessore; in pressofusione lo sformo è dato nell'estrusione attorno al piano di
 * divisione a metà spessore (le due metà si sformano in versi opposti), poi i raccordi.
 */

type Lib = typeof Smlib;

export type VarianteFibbia = 'rettangolare' | 'ovale' | 'a_d' | 'doppia';

export type ParametriFibbia = {
  cinturino: { larghezza: number; spessore: number };
  telaio: {
    altezzaInterna: number;
    sezioneLarghezza: number;
    sezioneSpessore: number;
    raggioAngoli: number;
    profilo: 'piatto' | 'bombato' | 'tondo';
    raggioBordo: number;
  };
  ardiglione: { diametro: number; gioco: number; materiale: 'acciaio' | 'inox' | 'ottone' };
  traversino: { abilitato: boolean; larghezza: number; profilo: 'piatto' | 'tondo' };
  costruzione: { processo: 'pressofusione_zama' | 'fusione_cera_persa' | 'cnc'; sformo: number };
};

const varianti = ['rettangolare', 'ovale', 'a_d', 'doppia'] as const;

const luceDi = (p: { cinturino: { larghezza: number } }): number => p.cinturino.larghezza + 1;

const parametri: readonly DefinizioneParametro[] = [
  {
    chiave: 'cinturino.larghezza',
    unita: 'mm',
    min: 8,
    max: 60,
    default: 20,
    fonteDefault: 'mestiere',
    critico: true,
    silhouetteSensibile: true,
    descrizione: 'Larghezza del cinturino che passa nella fibbia',
  },
  {
    chiave: 'cinturino.spessore',
    unita: 'mm',
    min: 1.5,
    max: 5,
    default: 3,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore del cinturino',
  },
  {
    chiave: 'telaio.luce',
    unita: 'mm',
    default: 21,
    fonteDefault: 'derivato',
    derivato: (p) => luceDi(p as ParametriFibbia),
    descrizione: 'Luce interna: cinturino + 1 mm di gioco',
  },
  {
    chiave: 'telaio.altezzaInterna',
    unita: 'mm',
    min: 6,
    max: 40,
    default: 12,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Apertura interna lungo il cinturino: max(10, 2 × spessore cinturino + 6)',
  },
  {
    chiave: 'telaio.sezioneLarghezza',
    unita: 'mm',
    min: 1.5,
    max: 8,
    default: 3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Larghezza della sezione del telaio',
  },
  {
    chiave: 'telaio.sezioneSpessore',
    unita: 'mm',
    min: 1.2,
    max: 6,
    default: 2.5,
    fonteDefault: 'mestiere',
    descrizione: 'Spessore della sezione del telaio',
  },
  {
    chiave: 'telaio.raggioAngoli',
    unita: 'mm',
    min: 0,
    max: 20,
    default: 3,
    fonteDefault: 'mestiere',
    silhouetteSensibile: true,
    descrizione: 'Raggio degli angoli interni (esterni = raggio + sezione)',
  },
  {
    chiave: 'telaio.profilo',
    unita: 'enum',
    valori: ['piatto', 'bombato', 'tondo'],
    default: 'bombato',
    fonteDefault: 'mestiere',
    descrizione: 'Profilo della sezione',
  },
  {
    chiave: 'telaio.raggioBordo',
    unita: 'mm',
    min: 0,
    max: 3,
    default: 0.75,
    fonteDefault: 'mestiere',
    descrizione: 'Raccordo dei bordi del profilo piatto (0,3 × spessore)',
  },
  {
    chiave: 'ardiglione.diametro',
    unita: 'mm',
    min: 1.5,
    max: 4.5,
    default: 2.5,
    fonteDefault: 'mestiere',
    descrizione: 'Diametro del filo dell’ardiglione',
  },
  {
    chiave: 'ardiglione.lunghezza',
    unita: 'mm',
    default: 16.5,
    fonteDefault: 'derivato',
    derivato: (p) => {
      const { telaio } = p as ParametriFibbia;
      return telaio.altezzaInterna + telaio.sezioneLarghezza + 1.5;
    },
    descrizione: 'Lunghezza dell’ardiglione: apertura + sezione + 1,5 mm',
  },
  {
    chiave: 'ardiglione.gioco',
    unita: 'mm',
    min: 0.2,
    max: 0.6,
    default: 0.3,
    fonteDefault: 'mestiere',
    descrizione: 'Gioco dell’occhio dell’ardiglione attorno alla barra',
  },
  {
    chiave: 'ardiglione.materiale',
    unita: 'enum',
    valori: ['acciaio', 'inox', 'ottone'],
    default: 'acciaio',
    fonteDefault: 'mestiere',
    descrizione: 'Materiale del filo',
  },
  {
    chiave: 'traversino.abilitato',
    unita: 'bool',
    default: false,
    fonteDefault: 'mestiere',
    descrizione: 'Barra centrale (l’ardiglione vi si avvolge)',
  },
  {
    chiave: 'traversino.larghezza',
    unita: 'mm',
    min: 1.5,
    max: 6,
    default: 2.5,
    fonteDefault: 'mestiere',
    descrizione: 'Larghezza del traversino',
  },
  {
    chiave: 'traversino.profilo',
    unita: 'enum',
    valori: ['piatto', 'tondo'],
    default: 'piatto',
    fonteDefault: 'scelta_nostra',
    descrizione: 'Sezione del traversino: piatta (90 % dello spessore) o tonda di diametro = larghezza',
  },
  {
    chiave: 'costruzione.processo',
    unita: 'enum',
    valori: ['pressofusione_zama', 'fusione_cera_persa', 'cnc'],
    default: 'pressofusione_zama',
    fonteDefault: 'mestiere',
    descrizione: 'Processo produttivo del telaio',
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

const sostituzioniVariante: Readonly<Record<VarianteFibbia, Readonly<Record<string, boolean | number | string>>>> = {
  rettangolare: {},
  ovale: {},
  a_d: {},
  doppia: { 'traversino.abilitato': true },
};

const varianteDi = (opzioni?: OpzioniFamiglia): VarianteFibbia =>
  varianti.includes(opzioni?.variante as VarianteFibbia) ? (opzioni!.variante as VarianteFibbia) : 'rettangolare';

const predefiniti = (variante?: string): ParametriFibbia =>
  predefinitiDaParametri<ParametriFibbia>(parametri, sostituzioniVariante[varianteDi({ variante })]);

const vincoli = (p: ParametriFibbia): { chiave: string; messaggio: string }[] => {
  const violati: { chiave: string; messaggio: string }[] = [];
  const { telaio, ardiglione, traversino } = p;
  const luce = luceDi(p);
  if (telaio.sezioneSpessore > telaio.sezioneLarghezza * 2) {
    violati.push({ chiave: 'telaio.sezioneSpessore', messaggio: 'Lo spessore supera il doppio della larghezza.' });
  }
  if (telaio.raggioAngoli > Math.min(luce, telaio.altezzaInterna) / 2) {
    violati.push({ chiave: 'telaio.raggioAngoli', messaggio: 'Il raggio supera metà della luce o dell’apertura.' });
  }
  if (ardiglione.diametro > telaio.sezioneSpessore + 1) {
    violati.push({ chiave: 'ardiglione.diametro', messaggio: 'L’ardiglione è più grosso del telaio + 1 mm.' });
  }
  if (telaio.raggioBordo > 0.45 * Math.min(telaio.sezioneSpessore, telaio.sezioneLarghezza)) {
    violati.push({ chiave: 'telaio.raggioBordo', messaggio: 'Il raccordo supera 0,45 della sezione.' });
  }
  if (traversino.abilitato && traversino.larghezza > telaio.altezzaInterna / 3) {
    violati.push({ chiave: 'traversino.larghezza', messaggio: 'Il traversino occupa più di un terzo dell’apertura.' });
  }
  return violati;
};

const normalizza = (grezzi: unknown, opzioni?: OpzioniFamiglia): ParametriFibbia => {
  const p = normalizzaConParametri(parametri, grezzi, predefiniti(varianteDi(opzioni)));
  const { telaio, ardiglione, traversino } = p;
  telaio.sezioneSpessore = Math.min(telaio.sezioneSpessore, telaio.sezioneLarghezza * 2);
  telaio.raggioAngoli = Math.min(telaio.raggioAngoli, Math.min(luceDi(p), telaio.altezzaInterna) / 2);
  ardiglione.diametro = Math.min(ardiglione.diametro, telaio.sezioneSpessore + 1);
  telaio.raggioBordo = Math.min(telaio.raggioBordo, 0.45 * Math.min(telaio.sezioneSpessore, telaio.sezioneLarghezza));
  traversino.larghezza = Math.max(1.5, Math.min(traversino.larghezza, telaio.altezzaInterna / 3));
  return p;
};

/** Materiale del telaio dal processo: zama pressofusa, ottone fuso o lavorato. */
const materialeTelaio = (processo: Processo): string => (processo === 'pressofusione_zama' ? 'zama' : 'ottone');

/** Il contorno esterno del telaio (schizzo su XY, centrato). */
function sagomaEsterna(lib: Lib, variante: VarianteFibbia, p: ParametriFibbia): Smlib.Sketch {
  const w = p.telaio.sezioneLarghezza;
  const larghezza = luceDi(p) + 2 * w;
  const altezza = p.telaio.altezzaInterna + 2 * w;
  const raggio = p.telaio.raggioAngoli + w;
  if (variante === 'ovale') {
    return lib.Ellipse(larghezza / 2, altezza / 2);
  }
  if (variante === 'a_d') {
    let barra = lib.Rectangle(larghezza, altezza / 2).translate(0, -altezza / 4);
    if (raggio > 0) {
      barra = barra.fillet(raggio, [
        [-larghezza / 2, -altezza / 2],
        [larghezza / 2, -altezza / 2],
      ]);
    }
    const arco = lib
      .Ellipse(larghezza / 2, altezza / 2)
      .intersect(lib.Rectangle(larghezza, altezza / 2).translate(0, altezza / 4));
    return barra.fuse(arco);
  }
  return lib.Rectangle(larghezza, altezza, raggio > 0 ? { fillet: raggio } : {});
}

/** Raccordo con un solo ripiego (raggio dimezzato), poi rinuncia con avviso: mai lanciare. */
function raccorda(
  forma: Smlib.Part,
  spigoli: readonly Smlib.Edge[],
  raggio: number,
  dove: { pezzo: string; esiti: Esito[] },
): Smlib.Part {
  if (raggio <= 0 || spigoli.length === 0) {
    return forma;
  }
  for (const tentativo of [raggio, raggio / 2]) {
    try {
      const raccordata = forma.fillet(spigoli, tentativo);
      if (raccordata.isValid()) {
        if (tentativo < raggio) {
          dove.esiti.push(
            esito(
              'avviso',
              'RACCORDO_RIDOTTO',
              `${dove.pezzo}: raccordo ridotto da ${mm(raggio)} a ${mm(tentativo)}.`,
              {
                pezzo: dove.pezzo,
                valore: tentativo,
                soglia: raggio,
              },
            ),
          );
        }
        return raccordata;
      }
    } catch {
      // Il kernel rifiuta il raggio: si prova una volta con metà raggio, poi si rinuncia.
    }
  }
  dove.esiti.push(
    esito('avviso', 'RACCORDO_RIDOTTO', `${dove.pezzo}: raccordo di ${mm(raggio)} non costruibile, spigoli vivi.`, {
      pezzo: dove.pezzo,
      valore: 0,
      soglia: raggio,
    }),
  );
  return forma;
}

/** Il telaio con l'eventuale traversino, sformato in pressofusione e raccordato. */
function costruisciTelaio(lib: Lib, p: ParametriFibbia, variante: VarianteFibbia, esiti: Esito[]): Smlib.Part {
  const { telaio, traversino, costruzione } = p;
  const w = telaio.sezioneLarghezza;
  const s = telaio.sezioneSpessore;
  const luce = luceDi(p);
  const sformo = costruzione.processo === 'pressofusione_zama' ? costruzione.sformo : 0;
  const esterno = sagomaEsterna(lib, variante, p);
  let corpo: Smlib.Part;
  if (telaio.profilo === 'tondo') {
    const percorso = esterno.offset(-w / 2, { corners: 'round' }).wires()[0]!;
    corpo = lib.sweep(lib.Circle(s / 2), percorso).translate(0, 0, s / 2);
  } else {
    const anello = esterno.cut(esterno.offset(-w, { corners: 'round' }));
    corpo =
      sformo > 0
        ? lib
            .Pos(0, 0, s / 2)
            .mul(anello)
            .extrude(s / 2, { both: true, taper: sformo })
        : anello.extrude(s);
  }
  if (traversino.abilitato) {
    const barra =
      traversino.profilo === 'tondo'
        ? lib.Pos(0, 0, s / 2).mul(lib.Rot(0, 90, 0).mul(lib.Cylinder(traversino.larghezza / 2, luce + 2)))
        : sformo > 0
          ? lib
              .Pos(0, 0, s / 2)
              .mul(lib.Rectangle(luce + 1.6, traversino.larghezza))
              .extrude(0.45 * s, { both: true, taper: sformo })
          : lib
              .Pos(0, 0, 0.05 * s)
              .mul(lib.Rectangle(luce + 1.6, traversino.larghezza))
              .extrude(0.9 * s);
    corpo = normalizzaForma(lib, corpo.fuse(barra));
  } else {
    corpo = normalizzaForma(lib, corpo);
  }
  const dove = { pezzo: 'Telaio', esiti };
  if (telaio.profilo === 'bombato') {
    corpo = raccorda(corpo, [...corpo.edges().top()], 0.45 * Math.min(s, w), dove);
  } else if (telaio.profilo === 'piatto') {
    corpo = raccorda(corpo, [...corpo.edges().top(), ...corpo.edges().bottom()], telaio.raggioBordo, dove);
  }
  return normalizzaForma(lib, corpo);
}

/** Dove si avvolge l'ardiglione: centro della barra (y, z) e raggio che ne racchiude la sezione. */
function pernoArdiglione(p: ParametriFibbia): { y: number; z: number; raggio: number } {
  const { telaio, traversino } = p;
  const s = telaio.sezioneSpessore;
  if (traversino.abilitato) {
    return {
      y: 0,
      z: s / 2,
      raggio:
        traversino.profilo === 'tondo' ? traversino.larghezza / 2 : Math.hypot(traversino.larghezza / 2, 0.45 * s),
    };
  }
  const w = telaio.sezioneLarghezza;
  return {
    y: -(telaio.altezzaInterna / 2 + w / 2),
    z: s / 2,
    raggio: telaio.profilo === 'tondo' ? s / 2 : Math.hypot(w / 2, s / 2),
  };
}

/** L'ardiglione: filo tondo con l'occhio attorno alla barra e il tratto dritto che passa sopra la barra opposta. */
function costruisciArdiglione(lib: Lib, p: ParametriFibbia, esiti: Esito[]): Smlib.Part {
  const d = p.ardiglione.diametro;
  const perno = pernoArdiglione(p);
  const raggioOcchio = perno.raggio + p.ardiglione.gioco + d / 2;
  const quota = perno.z + raggioOcchio;
  const punta = p.telaio.altezzaInterna / 2 + p.telaio.sezioneLarghezza / 2 + 1;
  // L'occhio gira dietro la barra e si ferma prima di toccare il tratto dritto (distanza fra gli assi ≥ d + 0,2).
  const seno = Math.max(-1, Math.min(1, 1 - (d + 0.2) / raggioOcchio));
  const ampiezza = 270 + (Math.asin(seno) * 180) / Math.PI;
  // Tratto dritto: cilindro lungo +Y con la punta raccordata (primitiva, prima di ogni booleana).
  let tratto = lib
    .Pos(0, perno.y, quota)
    .mul(
      lib
        .Rot(-90, 0, 0)
        .mul(lib.Cylinder(d / 2, punta - perno.y, { align: [lib.Align.CENTER, lib.Align.CENTER, lib.Align.MIN] })),
    );
  const spigoliPunta = tratto.edges().filter((spigolo) => spigolo.center().y > punta - 1e-3);
  tratto = raccorda(tratto, [...spigoliPunta], 0.45 * d, { pezzo: 'Ardiglione', esiti });
  // Occhio: un arco solo si spazza come una rivoluzione (rapido); il tratto lo continua sulla stessa sezione.
  const occhio = lib.sweep(
    lib.Circle(d / 2),
    lib.CenterArc([perno.y, perno.z], raggioOcchio, 90, ampiezza, lib.Plane.YZ),
  );
  return normalizzaForma(lib, occhio.fuse(tratto));
}

function costruisciConEsiti(lib: Lib, p: ParametriFibbia, opzioni?: OpzioniFamiglia): RisultatoCostruzione {
  const variante = varianteDi(opzioni);
  const esiti: Esito[] = [];
  const pezzi: PezzoFamiglia[] = [];
  const materiali = { telaio: materialeTelaio(p.costruzione.processo), ardiglione: p.ardiglione.materiale };
  try {
    const telaio = costruisciTelaio(lib, p, variante, esiti);
    pezzi.push({
      name: 'Telaio',
      shape: telaio,
      ruolo: 'telaio',
      materiale: materiali.telaio,
      ...aspettoMateriale(materiali.telaio),
    });
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Telaio non costruito: ${(error as Error).message}`, { pezzo: 'Telaio' }),
    );
  }
  try {
    const ardiglione = costruisciArdiglione(lib, p, esiti);
    pezzi.push({
      name: 'Ardiglione',
      shape: ardiglione,
      ruolo: 'ardiglione',
      materiale: materiali.ardiglione,
      ...aspettoMateriale(materiali.ardiglione),
    });
  } catch (error) {
    esiti.push(
      esito('blocco', 'SOLIDO_NON_VALIDO', `Ardiglione non costruito: ${(error as Error).message}`, {
        pezzo: 'Ardiglione',
      }),
    );
  }
  for (const pezzo of pezzi) {
    if (!(pezzo.shape instanceof lib.Part) || !pezzo.shape.isValid()) {
      esiti.push(
        esito('blocco', 'SOLIDO_NON_VALIDO', `${pezzo.name}: il kernel non lo dà valido.`, { pezzo: pezzo.name }),
      );
    }
  }
  return { pezzi, esiti };
}

function verifiche(
  lib: Lib,
  pezzi: readonly PezzoFamiglia[],
  p: ParametriFibbia,
  processo: Processo = p.costruzione.processo,
): Esito[] {
  const esiti: Esito[] = [];
  const { telaio: t, ardiglione: a } = p;
  const materialeT = materialeTelaio(processo);
  const sezione = t.profilo === 'tondo' ? t.sezioneSpessore : Math.min(t.sezioneSpessore, t.sezioneLarghezza);
  esiti.push(
    esitoMinimo('PARETE_MIN', sezione, sogliaParete(processo, materialeT), 'Sezione del telaio', { pezzo: 'Telaio' }),
  );
  const telaio = pezzi.find((pezzo) => pezzo.ruolo === 'telaio');
  const ardiglione = pezzi.find((pezzo) => pezzo.ruolo === 'ardiglione');
  const sformoMinimo = sogliaSformo(processo);
  if (sformoMinimo !== undefined && telaio?.shape instanceof lib.Part) {
    if (t.profilo === 'tondo') {
      esiti.push(
        esito('info', 'SFORMO', 'Sezione tonda: il piano di divisione all’equatore la sforma da sé.', {
          pezzo: 'Telaio',
        }),
      );
    } else {
      esiti.push(
        ...esitiSformo(
          sformoDuePiani(telaio.shape, t.sezioneSpessore / 2, sformoMinimo - 1e-3),
          sformoMinimo,
          'Telaio',
          'Telaio',
        ),
      );
    }
  }
  const raggioMinimo = soglieProcessi[processo].raggioMinimo;
  const raggio =
    t.profilo === 'bombato'
      ? 0.45 * Math.min(t.sezioneSpessore, t.sezioneLarghezza)
      : t.profilo === 'tondo'
        ? t.sezioneSpessore / 2
        : t.raggioBordo;
  if (raggioMinimo !== undefined) {
    esiti.push(
      raggio === 0
        ? esito('avviso', 'RAGGI_MIN', `Spigoli vivi sul telaio: almeno ${mm(raggioMinimo)} di raccordo.`, {
            pezzo: 'Telaio',
            valore: 0,
            soglia: raggioMinimo,
          })
        : esitoMinimo('RAGGI_MIN', raggio, raggioMinimo, 'Raccordo del telaio', { pezzo: 'Telaio', fattoreBlocco: 0 }),
    );
  }
  const filoMinimo = a.materiale === 'ottone' ? 2.2 : 1.8;
  esiti.push(esitoMinimo('ARDIGLIONE_D', a.diametro, filoMinimo, 'Diametro dell’ardiglione', { pezzo: 'Ardiglione' }));
  if (materialeT === 'zama' || materialeT === 'ottone') {
    esiti.push(
      esito('info', 'GALVANICA', 'Galvanica 5–15 µm non modellata: aggiungerla in tavola.', { pezzo: 'Telaio' }),
    );
  }
  const gioco = luceDi(p) - p.cinturino.larghezza;
  esiti.push(
    gioco >= 0.5 && gioco <= 2
      ? esito('ok', 'LUCE_CINTURINO', `Luce ${mm(luceDi(p))} per un cinturino di ${mm(p.cinturino.larghezza)}.`, {
          valore: gioco,
        })
      : esito('avviso', 'LUCE_CINTURINO', `Gioco del cinturino ${mm(gioco)} fuori da 0,5–2 mm.`, { valore: gioco }),
  );
  if (telaio?.shape instanceof lib.Part && ardiglione?.shape instanceof lib.Part) {
    let comune = 0;
    try {
      comune = telaio.shape.intersect(ardiglione.shape).volume;
    } catch {
      comune = 0;
    }
    esiti.push(
      comune > 1e-3
        ? esito('blocco', 'INTERFERENZA', `L’ardiglione entra nel telaio per ${comune.toFixed(3)} mm³.`, {
            valore: comune,
          })
        : esito('ok', 'INTERFERENZA', 'Ardiglione e telaio non si compenetrano.', { valore: comune }),
    );
  }
  esiti.push(...esitiPezzi(lib, pezzi));
  return esiti;
}

/**
 * Parametri che riproducono il pilota «Fibbia · strumenti manuali» (`libs/tau-examples/.../manual-buckle-fixture`):
 * cinturino 25 + 1, apertura 36, sezione 4 × 4, angoli 1/5, traversino tondo ⌀ 3,2, telaio senza sformo né raccordi.
 * L'ardiglione è il filo tondo della famiglia (il pilota ha un ardiglione piatto con occhio a cannula).
 */
export const presetPilotaFibbia: { variante: VarianteFibbia; parametri: ParametriFibbia } = {
  variante: 'doppia',
  parametri: {
    cinturino: { larghezza: 25, spessore: 3 },
    telaio: {
      altezzaInterna: 36,
      sezioneLarghezza: 4,
      sezioneSpessore: 4,
      raggioAngoli: 1,
      profilo: 'piatto',
      raggioBordo: 0,
    },
    ardiglione: { diametro: 2.5, gioco: 0.4, materiale: 'acciaio' },
    traversino: { abilitato: true, larghezza: 3.2, profilo: 'tondo' },
    costruzione: { processo: 'cnc', sformo: 1 },
  },
};

export const fibbia: Famiglia<ParametriFibbia> = {
  id: 'fibbia',
  versione: 1,
  varianti,
  partTypes: ['buckle'],
  schema: schemaDaParametri<ParametriFibbia>(parametri),
  parametri,
  predefiniti,
  vincoli,
  normalizza,
  costruisci: (lib, p, opzioni) => costruisciConEsiti(lib, p, opzioni).pezzi,
  costruisciConEsiti,
  verifiche,
  silhouette: { assi: ['z'], simmetrie: ['yz'] },
  materialiAmmessi: ['zama', 'ottone', 'acciaio', 'inox'],
  emettiMain: (p, ipotesi, opzioni) => emettiMainFamiglia('fibbia', 1, varianteDi(opzioni), p, ipotesi),
};
