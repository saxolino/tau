/* oxlint-disable no-barrel-files/no-barrel-files -- the recognition module's public entry, like `famiglie/index.ts`. */
export type * from '#riconoscimento/condiviso.js';
export {
  applicaLimiti,
  convalidaStruttura,
  normalizzaUscita,
  promptRiconoscimento,
  risolviFamiglia,
  confidenzaCorretto,
  confidenzaNonVisibile,
} from '#riconoscimento/condiviso.js';
export { schedaParteSchema, verticali, fontiTipo, tipiScala } from '#riconoscimento/scheda-parte.js';
export type { SchedaParte } from '#riconoscimento/scheda-parte.js';
export {
  schedaRiconoscimentoSchema,
  parametroRiconosciutoSchema,
  idRiconoscibili,
  nomiVista,
  fontiParametro,
  fontiScalaRiconosciuta,
  schemaPerApi,
} from '#riconoscimento/schema.js';
export type { SchedaRiconoscimento, ParametroRiconosciuto } from '#riconoscimento/schema.js';
export { soglie, statoValore } from '#riconoscimento/soglie.js';
export { domandaFamiglia, domandeParametri, prossimaDomanda } from '#riconoscimento/domande.js';
export type {
  DomandaFamiglia,
  DomandaParametro,
  DomandaScala,
  DomandaRiconoscimento,
} from '#riconoscimento/domande.js';
export {
  asseDaCosa,
  confidenzaScala,
  estensioneMaschera,
  larghezzaForoInterno,
  lunghezzaPiantaDaTaglia,
  pxPerMmDaMisura,
  scegliScala,
} from '#riconoscimento/scala.js';
export type { AsseMisura, CandidatiScala, Estensione, MascheraBinaria } from '#riconoscimento/scala.js';
export { mappaLibreria, mappaPartType, partTypesSinopia, tipiLibreria } from '#riconoscimento/famiglia-da-part-type.js';
export type { PartTypeSinopia, TipoLibreria } from '#riconoscimento/famiglia-da-part-type.js';
export {
  catalogoFamiglie,
  famigliaCatalogo,
  generaContratto,
  modelloRiconoscimento,
  testoContratto,
  versioneContratto,
} from '#riconoscimento/contratto.js';
export { promptPerScheda } from '#riconoscimento/prompt.js';
export { materialeDelVisore, materialiPerPezzo } from '#riconoscimento/materiali-pezzi.js';
export type { MaterialePezzo } from '#riconoscimento/materiali-pezzi.js';
export { schedaConsegnata } from '#riconoscimento/consegna.js';
export { riscalaScheda } from '#riconoscimento/riscala.js';
export { famigliaDelRegistro, pianoCostruzione } from '#riconoscimento/costruisci.js';
export type { PianoCostruzione, RisposteUtente } from '#riconoscimento/costruisci.js';
export {
  assumptionDescription,
  assumptionMarker,
  formatAssumption,
  parseAssumptionDescription,
} from '#parameter-assumptions.js';
export type { AssumptionDetails } from '#parameter-assumptions.js';
export { schedaParteDiProva, schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
