/**
 * Le viste di una famiglia: quale faccia del pezzo mostra una foto e come si traduce in camera.
 *
 * Ogni famiglia ha il proprio telaio (la fibbia giace su XY con la faccia a vista +Z, il tacco si guarda di fianco, da
 * +X): chiedere al modello angoli «assoluti» in quel telaio dava camere di taglio sul pezzo. Il modello dice invece
 * QUALE FACCIA vede, con le parole del mestiere della famiglia, più due piccoli scarti da quella faccia vista dritta;
 * la conversione in camera la fa il codice (`verifica/vista-famiglia.ts`), in modo deterministico, dai dati qui sotto.
 */

/**
 * Gli identificativi delle facce che il modello può scegliere (enum dello schema d'uscita). Ogni famiglia ne usa un
 * sottoinsieme e li descrive con le sue parole: l'id è solo la chiave, la direzione nel telaio sta in `camera`.
 * @public
 */
export const facceVista = [
  'sopra',
  'sotto',
  'davanti',
  'dietro',
  'fianco_esterno',
  'fianco_interno',
  'tre_quarti_pietra',
  'asse_dito',
] as const;

/** Un identificativo di faccia. @public */
export type IdFaccia = (typeof facceVista)[number];

/** Camera che guarda una faccia «dritta», nel telaio della famiglia (convenzioni di `verifica/camera.ts`). @public */
export type CameraFaccia = { azimuth: number; elevation: number; rollo: number };

/** Una faccia di una famiglia: dove sta la camera e come la descrive il mestiere (inglese, per il modello). @public */
export type FacciaFamiglia = {
  id: IdFaccia;
  /** Parole del mestiere: che cosa si vede, e verso dove sta il pezzo nell'immagine. */
  descrizione: string;
  /** La camera che la guarda dritta, con il pezzo «in piedi» nell'immagine (rollo 0). */
  camera: CameraFaccia;
};

/** Le quattro viste per nome che il mestiere usa, come faccia più scarto di camera da quella faccia. @public */
export type NomiVista = 'fronte' | 'tre_quarti' | 'lato' | 'alto';

/** Una vista per nome: la faccia e lo scarto di azimuth ed elevation (gradi) dalla vista dritta. @public */
export type VistaPerNome = { faccia: IdFaccia; azimuth: number; elevation: number };

/**
 * I dati delle viste di una famiglia (campo `viste` della famiglia, copiato nel contratto con Sinopia).
 * @public
 */
export type VisteFamiglia = {
  /** La faccia «di prodotto»: quella che una foto di catalogo mostra. */
  principale: IdFaccia;
  facce: readonly FacciaFamiglia[];
  /** Come «fronte / tre quarti / lato / alto» si mappano su faccia e scarti in questa famiglia. */
  nomi: Readonly<Record<NomiVista, VistaPerNome>>;
};

/**
 * Le viste piatte (ortogonali) che si generano dalla foto per ricostruire un pezzo: la principale, da cui si leggono
 * profili e rapporti, e le viste di controllo, da cui si leggono spessori e profondità. Le facce sono id di
 * `viste.facce` della famiglia: la camera la dà la faccia, la generazione la sceglie il server dalla tabella
 * (`famiglie/viste-ortogonali.ts`, copiata nel contratto come `famiglie[].viste.ortogonali`).
 * @public
 */
export type VisteOrtogonali = {
  /** La vista principale: piatta e completa, è quella su cui lavora l'ottimizzatore. */
  principale: IdFaccia;
  /** Le viste di controllo: la prima è di serie, le altre si generano solo su richiesta (tacco: la seduta dall'alto). */
  controllo: readonly IdFaccia[];
};

/**
 * Le viste ortogonali di una famiglia, con le varianti che si guardano diversamente (il fondo: la suola da sotto,
 * l'intersuola o zeppa di fianco).
 * @public
 */
export type VisteOrtogonaliFamiglia = VisteOrtogonali & {
  /** Per variante: quando la parte è quella variante le facce cambiano. */
  varianti?: Readonly<Record<string, VisteOrtogonali>>;
};

/**
 * Una faccia con camera data da azimuth ed elevation (rollo 0).
 * @param id - Identificativo della faccia.
 * @param azimuth - Azimuth della camera che la guarda dritta.
 * @param elevation - Elevation della camera che la guarda dritta.
 * @param descrizione - Parole del mestiere.
 * @returns La faccia.
 * @public
 */
// oxlint-disable-next-line eslint/max-params -- scrittura compatta delle tabelle delle facce nelle famiglie.
export const faccia = (id: IdFaccia, azimuth: number, elevation: number, descrizione: string): FacciaFamiglia => ({
  id,
  descrizione,
  camera: { azimuth, elevation, rollo: 0 },
});

/**
 * Le facce di un pezzo piatto su XY con la faccia a vista +Z (fibbia, placca, pendente): faccia superiore, retro e i
 * due bordi. Dall'alto l'immagine ha +Y in alto e +X a destra; dal basso +Y in alto e −X a destra.
 * @param parole - Come il mestiere chiama: faccia a vista, retro, bordo visto da +X, bordo visto da −Y.
 * @returns Le quattro facce.
 * @public
 */
export const facceDiPezzoPiatto = (parole: {
  sopra: string;
  sotto: string;
  fianco: string;
  dietro: string;
}): FacciaFamiglia[] => [
  faccia('sopra', 0, 90, parole.sopra),
  faccia('sotto', 180, -90, parole.sotto),
  faccia('fianco_esterno', 90, 0, parole.fianco),
  faccia('dietro', 0, 0, parole.dietro),
];

/** Le viste per nome di un pezzo piatto: fronte e alto sono la faccia a vista, lato il bordo. @public */
export const nomiPezzoPiatto: VisteFamiglia['nomi'] = {
  fronte: { faccia: 'sopra', azimuth: 0, elevation: 0 },
  tre_quarti: { faccia: 'sopra', azimuth: 30, elevation: 30 },
  lato: { faccia: 'fianco_esterno', azimuth: 0, elevation: 0 },
  alto: { faccia: 'sopra', azimuth: 0, elevation: 0 },
};
