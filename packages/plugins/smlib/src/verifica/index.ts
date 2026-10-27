/* oxlint-disable no-barrel-files/no-barrel-files -- the verification entry of D3 (silhouette ↔ mask). */
export { assiCamera, pianoDaPixel, proiettore, vistaRender } from '#verifica/camera.js';
export type { AssiCamera, CameraVerifica, Vettore3 } from '#verifica/camera.js';
export { componentePiuGrande, momenti, preparaMaschera, preparaMascheraPng } from '#verifica/maschera.js';
export type {
  CanaleMaschera,
  LatoOccluso,
  MascheraPreparata,
  MomentiMaschera,
  OpzioniMaschera,
} from '#verifica/maschera.js';
export {
  confronta,
  contorno,
  immagineDifferenza,
  iouMorbido,
  iouValida,
  obiettivo,
  PESI_OBIETTIVO,
  preparaConfronto,
  prior,
  sigmaParametro,
  trasformataDistanza,
} from '#verifica/metrica.js';
export type { Confronto, ConfrontoMaschera, StimaParametri } from '#verifica/metrica.js';
export { nelderMead } from '#verifica/nelder-mead.js';
export type { OpzioniNelderMead, RisultatoNelderMead, StatoNelderMead } from '#verifica/nelder-mead.js';
export { parametriSensibili, SEMPLIFICAZIONI_SILHOUETTE, verificaSilhouette } from '#verifica/ottimizza.js';
export type {
  EsitoFase,
  EsitoVerifica,
  FonteScala,
  IngressoVerifica,
  NomeFase,
  OpzioniOttimizzatore,
  VistaStimata,
} from '#verifica/ottimizza.js';
export {
  BUDGET_DOPO_RIENTRO_MS,
  consegnaVerifica,
  esitoDaIou,
  richiestaDaScheda,
  SOGLIE_VERIFICA,
  TESTO_RIENTRO,
} from '#verifica/pipeline.js';
export type {
  ChipVerifica,
  Consegna,
  EsitoSoglia,
  FonteClassificatore,
  ParametroConsegnato,
  SchedaPerVerifica,
} from '#verifica/pipeline.js';
export { codificaPng, decodificaPng } from '#verifica/png.js';
export type { ImmagineRaster } from '#verifica/png.js';
export {
  LATO_VERIFICA,
  meshDaForme,
  riquadro,
  silhouetteMesh,
  silhouetteMeshMorbida,
  silhouetteRender,
  tolleranzaPerPixel,
} from '#verifica/silhouette.js';
export type { MascheraBinaria, MeshPiatta, SilhouetteMorbida } from '#verifica/silhouette.js';
export { casoSintetico, fotoSintetica, generatore, ingressoSintetico, VISTE_SINTETICHE } from '#verifica/sintetico.js';
export type { CasoSintetico, FotoSintetica } from '#verifica/sintetico.js';
export { creaVerificatore } from '#verifica/verifica-client.js';
export type { Verificatore } from '#verifica/verifica-client.js';
export { funzioniVerifica } from '#verifica/verifica-funzioni.js';
export type { RichiestaVerifica, RispostaVerifica } from '#verifica/verifica-funzioni.js';
