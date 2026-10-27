import type { VisteFamiglia, VistaPerNome } from '#famiglie/viste.js';
import { assiCamera } from '#verifica/camera.js';
import type { Vettore3 } from '#verifica/camera.js';

/**
 * Dalla vista del riconoscimento alla camera della verifica D3, nel telaio della famiglia.
 *
 * Il modello dice QUALE FACCIA del pezzo vede (`vista.faccia`, con le parole del mestiere della famiglia) e di quanti
 * gradi la foto si scosta dalla vista dritta di quella faccia: `azimuth` = quanto la camera è spostata verso destra
 * nell'immagine, `elevation` = quanto è alzata verso l'alto dell'immagine (0, 0 = di fronte alla faccia). Qui, con i
 * dati `viste` della famiglia, si compone la camera: la camera che guarda la faccia dritta gira attorno al pezzo di
 * quegli scarti (orbita a turntable sugli assi della sua immagine). Nessuna scelta del modello entra nella geometria.
 */

/** La vista come la dà il riconoscimento (sottoinsieme della scheda D2). @public */
export type VistaDaConvertire = {
  /** Faccia scelta dal modello; assente nelle schede vecchie o registrate. */
  faccia?: string;
  nome?: string;
  azimuth: number;
  elevation: number;
  rollo: number;
};

/** Camera di partenza e da dove nasce. @public */
export type CameraDaVista = {
  azimuth: number;
  elevation: number;
  rollo: number;
  /** `faccia`: dalla faccia dichiarata; `nome`: dal nome della vista; `assoluta`: la famiglia non ha dati, angoli letti nel telaio. */
  origine: 'faccia' | 'nome' | 'assoluta';
};

const gradi = (radianti: number): number => (radianti * 180) / Math.PI;
const radianti = (g: number): number => (g * Math.PI) / 180;
const scalare = (a: Vettore3, b: Vettore3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// oxlint-disable-next-line eslint/max-params -- combinazione lineare di due vettori: a·ka + b·kb.
const combina = (a: Vettore3, ka: number, b: Vettore3, kb: number): Vettore3 => [
  ka * a[0] + kb * b[0],
  ka * a[1] + kb * b[1],
  ka * a[2] + kb * b[2],
];
const intorno = (angolo: number): number => ((((angolo + 180) % 360) + 360) % 360) - 180;

/**
 * La camera che guarda una faccia e poi gira attorno al pezzo.
 * @param base - Camera che guarda la faccia dritta (azimuth, elevation, rollo nel telaio della famiglia).
 * @param scarti - `azimuth`: gradi di spostamento verso destra nell'immagine; `elevation`: verso l'alto; `rollo`:
 *   rotazione nel piano immagine (gradi, antioraria), che si somma.
 * @returns Azimuth, elevation e rollo della camera della verifica.
 * @public
 */
export function cameraDaFaccia(
  base: { azimuth: number; elevation: number; rollo: number },
  scarti: { azimuth: number; elevation: number; rollo: number },
): { azimuth: number; elevation: number; rollo: number } {
  const { direzione, su, destra } = assiCamera(base);
  const posizione: Vettore3 = [-direzione[0], -direzione[1], -direzione[2]];
  const giro = radianti(scarti.azimuth);
  const alzata = radianti(scarti.elevation);
  // Giro attorno all'alto dell'immagine (la camera va a destra), poi verso l'alto dell'immagine.
  const dopoAzimuth = combina(posizione, Math.cos(giro), destra, Math.sin(giro));
  const nuovaPosizione = combina(dopoAzimuth, Math.cos(alzata), su, Math.sin(alzata));
  const nuovoSu = combina(dopoAzimuth, -Math.sin(alzata), su, Math.cos(alzata));
  const elevation = gradi(Math.asin(Math.max(-1, Math.min(1, nuovaPosizione[2]))));
  const polare = Math.abs(nuovaPosizione[2]) > 1 - 1e-9;
  const azimuth = polare ? 0 : gradi(Math.atan2(nuovaPosizione[0], -nuovaPosizione[1]));
  const riferimento = assiCamera({ azimuth, elevation, rollo: 0 });
  const rolloOrbita = gradi(Math.atan2(scalare(nuovoSu, riferimento.destra), scalare(nuovoSu, riferimento.su)));
  return { azimuth, elevation, rollo: intorno(rolloOrbita + scarti.rollo) };
}

const dalNome = (viste: VisteFamiglia, nome: string | undefined): VistaPerNome | undefined => {
  if (nome === undefined) {
    return undefined;
  }
  const diretta = viste.facce.find((faccia) => faccia.id === nome);
  if (diretta) {
    return { faccia: diretta.id, azimuth: 0, elevation: 0 };
  }
  return nome === 'fronte'
    ? viste.nomi.fronte
    : nome === 'tre_quarti'
      ? viste.nomi.tre_quarti
      : nome === 'fianco_esterno' || nome === 'fianco_interno'
        ? viste.nomi.lato
        : nome === 'sopra'
          ? viste.nomi.alto
          : undefined;
};

/**
 * La faccia e gli scarti per una vista registrata prima che la scheda nominasse la faccia: gli angoli di allora erano
 * assoluti, quindi si riparte dal nome della vista (come fa `cameraDaVista`) o, se il nome non si risolve, dalla faccia
 * principale vista dritta.
 * @param viste - I dati `viste` della famiglia costruita.
 * @param nome - Il nome della vista registrato.
 * @returns Faccia, azimuth ed elevation da mettere nella scheda.
 * @public
 */
export function vistaSenzaFaccia(viste: VisteFamiglia, nome: string | undefined): VistaPerNome {
  const perNome = dalNome(viste, nome);
  return perNome && viste.facce.some((faccia) => faccia.id === perNome.faccia)
    ? perNome
    : { faccia: viste.principale, azimuth: 0, elevation: 0 };
}

/**
 * La camera di partenza della verifica D3 da quello che il riconoscimento dice della vista.
 *
 * Ordine: la faccia dichiarata (se è una faccia di questa famiglia) con gli scarti del modello; altrimenti il nome
 * della vista (`fronte`, `tre_quarti`…) risolto con la mappa della famiglia; altrimenti gli angoli letti così come sono
 * nel telaio (comportamento di prima: ci pensa la ricerca lungo gli assi della verifica).
 * @param viste - I dati `viste` della famiglia (assenti = nessuna conversione).
 * @param vista - La vista del riconoscimento.
 * @returns Azimuth, elevation, rollo e origine.
 * @public
 */
export function cameraDaVista(viste: VisteFamiglia | undefined, vista: VistaDaConvertire): CameraDaVista {
  const assoluta: CameraDaVista = {
    azimuth: vista.azimuth,
    elevation: vista.elevation,
    rollo: vista.rollo,
    origine: 'assoluta',
  };
  if (viste === undefined) {
    return assoluta;
  }
  const dichiarata = viste.facce.find((faccia) => faccia.id === vista.faccia);
  if (dichiarata) {
    return {
      ...cameraDaFaccia(dichiarata.camera, vista),
      origine: 'faccia',
    };
  }
  const perNome = dalNome(viste, vista.nome);
  const faccia = perNome && viste.facce.find((candidata) => candidata.id === perNome.faccia);
  if (perNome && faccia) {
    return {
      ...cameraDaFaccia(faccia.camera, { ...perNome, rollo: vista.rollo }),
      origine: 'nome',
    };
  }
  return assoluta;
}
