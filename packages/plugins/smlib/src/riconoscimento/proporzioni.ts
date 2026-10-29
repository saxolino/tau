import type { ContestoRiconoscimento } from '#riconoscimento/contesto.js';
import { estensioneMaschera } from '#riconoscimento/scala.js';
import type { MascheraBinaria } from '#riconoscimento/scala.js';

/**
 * Proporzioni e visibilità della parte nella foto (piano «viste ortogonali», §2.4), gratis: nessuna chiamata, solo i
 * riquadri di tutte le parti dell'analisi salvata e la maschera della parte. L'unione dei riquadri approssima il
 * prodotto intero; i rapporti sono misurati sulla foto così com'è, senza correggere la prospettiva, e un'affidabilità
 * dice quanto valgono. Viaggiano nel `contesto` della richiesta di riconoscimento (contratto v3).
 */

/** Un riquadro x0, y0, x1, y1 in 0–1000 (come le parti di Sinopia). @public */
export type Riquadro1000 = readonly [number, number, number, number];

/** Che cosa serve per misurare. @public */
export type IngressoProporzioni = Readonly<{
  /** La verticale del progetto: la forma «di fianco» si riconosce solo per le calzature. */
  verticale: string;
  immagine: Readonly<{ larghezzaPx: number; altezzaPx: number }>;
  /** Il riquadro della parte (0–1000). */
  riquadro: Riquadro1000;
  /** I riquadri delle altre parti dell'analisi (0–1000). */
  altreParti: ReadonlyArray<Readonly<{ box: Riquadro1000 }>>;
  /** La maschera della parte alla misura della foto: dà l'estensione vera e dice se tocca il bordo. */
  maschera?: MascheraBinaria;
}>;

/** Proporzioni e visibilità per il contesto della richiesta. @public */
export type MisureFoto = Readonly<{
  /** Assenti se non c'è un prodotto da misurare (nessun'altra parte) o se i rapporti escono dalla banda. */
  proporzioni?: NonNullable<ContestoRiconoscimento['proporzioni']>;
  visibilita: NonNullable<ContestoRiconoscimento['visibilita']>;
}>;

/** Le soglie delle proporzioni, in una costante sola. @public */
export const soglieProporzioni = {
  /** Una calzatura vista di fianco: lunghezza / altezza del prodotto fra 2 e 4,5. */
  fiancoMin: 2,
  fiancoMax: 4.5,
  /** Almeno tante parti formano il «prodotto». */
  partiMin: 3,
  /** Sotto questo lato lungo (pixel della foto) la maschera è «piccola». */
  latoPiccolo: 64,
  /** Un riquadro entro tanti millesimi dal bordo tocca il bordo (senza maschera). */
  bordoRiquadro: 2,
  affidabilitaAlta: 0.8,
  affidabilitaBassa: 0.3,
  /** I rapporti ammessi dal contratto: 0 < valore ≤ 5. */
  rapportoMax: 5,
} as const;

type Estensione = Readonly<{ x0: number; y0: number; x1: number; y1: number }>;
type Rapporto = NonNullable<MisureFoto['proporzioni']>['rapporti'][number];

const inPixel = (riquadro: Riquadro1000, immagine: IngressoProporzioni['immagine']): Estensione => ({
  x0: (Math.min(riquadro[0], riquadro[2]) * immagine.larghezzaPx) / 1000,
  y0: (Math.min(riquadro[1], riquadro[3]) * immagine.altezzaPx) / 1000,
  x1: (Math.max(riquadro[0], riquadro[2]) * immagine.larghezzaPx) / 1000,
  y1: (Math.max(riquadro[1], riquadro[3]) * immagine.altezzaPx) / 1000,
});

const valido = (riquadro: Riquadro1000): boolean =>
  riquadro.every((valore) => Number.isFinite(valore)) && riquadro[2] !== riquadro[0] && riquadro[3] !== riquadro[1];

const arrotonda = (valore: number): number => Math.round(valore * 1000) / 1000;

/**
 * La visibilità della parte: `tagliata_bordo` se la maschera (o, senza, il riquadro) tocca il bordo della foto,
 * `piccola` se il lato lungo della maschera è sotto i 64 px.
 * @param ingresso - Riquadro, foto e maschera.
 * @returns Stato e motivi.
 * @public
 */
export function visibilitaParte(ingresso: IngressoProporzioni): MisureFoto['visibilita'] {
  const motivi: Array<'tagliata_bordo' | 'piccola'> = [];
  const { maschera, riquadro } = ingresso;
  const estensione = maschera ? estensioneMaschera(maschera) : undefined;
  if (maschera && estensione) {
    if (
      estensione.x0 === 0 ||
      estensione.y0 === 0 ||
      estensione.x1 === maschera.larghezza - 1 ||
      estensione.y1 === maschera.altezza - 1
    ) {
      motivi.push('tagliata_bordo');
    }
    // La maschera può essere ridotta rispetto alla foto: il lato si riporta in pixel della foto.
    const fattore = ingresso.immagine.larghezzaPx / maschera.larghezza;
    if (Math.max(estensione.larghezza, estensione.altezza) * fattore < soglieProporzioni.latoPiccolo) {
      motivi.push('piccola');
    }
  } else {
    const bordo = soglieProporzioni.bordoRiquadro;
    if (Math.min(...riquadro) <= bordo || Math.max(...riquadro) >= 1000 - bordo) {
      motivi.push('tagliata_bordo');
    }
    const pixel = inPixel(riquadro, ingresso.immagine);
    if (Math.max(pixel.x1 - pixel.x0, pixel.y1 - pixel.y0) < soglieProporzioni.latoPiccolo) {
      motivi.push('piccola');
    }
  }
  return { stato: motivi.length > 0 ? 'parziale' : 'intera', motivi };
}

/**
 * Proporzioni e visibilità della parte nella foto. I rapporti: altezza della parte / lunghezza del prodotto, larghezza
 * della parte / lunghezza del prodotto, altezza della parte / altezza del prodotto (il prodotto è l'unione dei
 * riquadri, la parte la sua maschera o il suo riquadro). L'affidabilità è alta solo se l'unione ha la forma di una
 * calzatura vista di fianco (lunghezza / altezza fra 2 e 4,5), la parte non è tagliata e le parti sono almeno tre;
 * bassa in ogni altro caso (prospettiva, inquadratura parziale, borse e gioielli).
 * @param ingresso - Riquadri, foto e maschera.
 * @returns Le misure per il contesto.
 * @public
 */
export function misureDallaFoto(ingresso: IngressoProporzioni): MisureFoto {
  const visibilita = visibilitaParte(ingresso);
  const altre = ingresso.altreParti.map((altra) => altra.box).filter((box) => valido(box));
  if (altre.length === 0 || !valido(ingresso.riquadro)) {
    return { visibilita };
  }
  const { immagine } = ingresso;
  const riquadri = [ingresso.riquadro, ...altre].map((box) => inPixel(box, immagine));
  const prodotto = {
    x0: Math.min(...riquadri.map((r) => r.x0)),
    y0: Math.min(...riquadri.map((r) => r.y0)),
    x1: Math.max(...riquadri.map((r) => r.x1)),
    y1: Math.max(...riquadri.map((r) => r.y1)),
  };
  const estensione = ingresso.maschera ? estensioneMaschera(ingresso.maschera) : undefined;
  const fattore = ingresso.maschera ? immagine.larghezzaPx / ingresso.maschera.larghezza : 1;
  const parte = estensione
    ? { larghezza: estensione.larghezza * fattore, altezza: estensione.altezza * fattore }
    : { larghezza: riquadri[0]!.x1 - riquadri[0]!.x0, altezza: riquadri[0]!.y1 - riquadri[0]!.y0 };
  const lunghezzaProdotto = prodotto.x1 - prodotto.x0;
  const altezzaProdotto = prodotto.y1 - prodotto.y0;
  if (!(lunghezzaProdotto > 0) || !(altezzaProdotto > 0)) {
    return { visibilita };
  }
  const misurati: Rapporto[] = [
    { chiave: 'altezza_su_lunghezza', valore: parte.altezza / lunghezzaProdotto },
    { chiave: 'larghezza_su_lunghezza', valore: parte.larghezza / lunghezzaProdotto },
    { chiave: 'altezza_su_altezza', valore: parte.altezza / altezzaProdotto },
  ];
  const rapporti = misurati
    .map((rapporto) => ({ ...rapporto, valore: arrotonda(rapporto.valore) }))
    .filter((rapporto) => rapporto.valore > 0 && rapporto.valore <= soglieProporzioni.rapportoMax);
  if (rapporti.length === 0) {
    return { visibilita };
  }
  const parti = riquadri.length;
  const forma = lunghezzaProdotto / altezzaProdotto;
  const diFianco =
    ingresso.verticale === 'footwear' && forma >= soglieProporzioni.fiancoMin && forma <= soglieProporzioni.fiancoMax;
  const alta = diFianco && !visibilita.motivi.includes('tagliata_bordo') && parti >= soglieProporzioni.partiMin;
  return {
    proporzioni: {
      rapporti,
      affidabilita: alta ? soglieProporzioni.affidabilitaAlta : soglieProporzioni.affidabilitaBassa,
      parti,
    },
    visibilita,
  };
}
