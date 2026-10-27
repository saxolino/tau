/* oxlint-disable no-barrel-files/no-barrel-files -- the families registry is the public entry of the recipes. */
export type * from '#famiglie/famiglia.js';
export { materiali, materiale, aspettoMateriale } from '#famiglie/materiali.js';
export type { Materiale } from '#famiglie/materiali.js';
export { soglieProcessi, sogliaParete, sogliaSformo } from '#famiglie/processi.js';
export type { SoglieProcesso } from '#famiglie/processi.js';
export { valoriDerivati } from '#famiglie/parametri.js';
export { emettiMainFamiglia, moduloFamiglie } from '#famiglie/emetti-main.js';
export { rileggiStep } from '#famiglie/verifiche-comuni.js';
export { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
export type { Valutazione } from '#famiglie/valuta-famiglia.js';
export { famiglie } from '#famiglie/registro.js';
export { creaModuloFamiglie } from '#famiglie/modulo.js';
export type { FamigliaLegata } from '#famiglie/modulo.js';
export { fibbia, presetPilotaFibbia } from '#famiglie/fibbia.js';
export type { ParametriFibbia, VarianteFibbia } from '#famiglie/fibbia.js';
export { tacco } from '#famiglie/tacco.js';
export { placca, trattoLato } from '#famiglie/placca.js';
export type { ParametriPlacca, VariantePlacca } from '#famiglie/placca.js';
export { occhiello, volumeOcchiello } from '#famiglie/occhiello.js';
export type { ParametriOcchiello } from '#famiglie/occhiello.js';
export { borchia, raggioCalotta } from '#famiglie/borchia.js';
export type { ParametriBorchia, VarianteBorchia } from '#famiglie/borchia.js';
export { anello } from '#famiglie/anello.js';
export type { ParametriAnello, VarianteAnello } from '#famiglie/anello.js';
export {
  diametroInterno,
  intervalliTaglia,
  nomeSistemaTaglia,
  passoTaglia,
  rigaTaglia,
  tabellaTaglie,
  tagliaDaDiametro,
} from '#famiglie/taglie-anello.js';
export type { RigaTaglia, SistemaTaglia } from '#famiglie/taglie-anello.js';
export type { ParametriTacco, VarianteTacco } from '#famiglie/tacco.js';
export { fondoSemplice } from '#famiglie/fondo-semplice.js';
export type { ParametriFondo, VarianteFondo } from '#famiglie/fondo-semplice.js';
export {
  lunghezzaDaTaglia,
  piantaCanonica,
  piantaDaMisure,
  piantaDaTaglia,
  poligonoSemplice,
} from '#famiglie/fondo-pianta-canonica.js';
export type { Pianta } from '#famiglie/fondo-pianta-canonica.js';
export { pendente } from '#famiglie/pendente.js';
export type { ParametriPendente, VariantePendente } from '#famiglie/pendente.js';
export { puntale } from '#famiglie/puntale.js';
export type { ParametriPuntale } from '#famiglie/puntale.js';
export { ovale, ovaleQuattroCentri, estrudiSformato } from '#famiglie/profili.js';
export { ErroreLogo, leggiLogoSvg, percorsoLogo, svgDaLogo } from '#famiglie/logo-svg.js';
export type { CodiceErroreLogo, LogoLetto } from '#famiglie/logo-svg.js';
