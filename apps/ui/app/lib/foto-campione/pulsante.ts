import type { PlainMessageKey } from '#i18n/translate.js';

/**
 * Why «Genera foto» is off, from what the section knows; `undefined` when the photo can be made. One function, so the
 * order of the reasons — and which one a person reads — is tested once (SinopiaCAD D6, 29 ott difetto 31).
 *
 * `schermoUguale` is the screen against the sent version: `true` when its content says so (`stessoContenutoInviato`),
 * otherwise the shape comparison; `undefined` while neither can tell.
 */
export type StatoPulsanteFoto = Readonly<{
  isTrial: boolean;
  isSignedIn: boolean;
  isLinked: boolean;
  versione: 'in-lettura' | 'illeggibile' | 'nessuna' | 'pronta';
  isBuilding: boolean;
  hasModel: boolean;
  hasSentMesh: boolean;
  schermoUguale: boolean | undefined;
  isPriceLoading: boolean;
  hasPrice: boolean;
  isReady: boolean;
}>;

/**
 * The reason the photo button is off.
 *
 * @param stato - What the section knows.
 * @returns The sentence key, or `undefined` when the photo can be made.
 */
export function motivoFotoSpenta(stato: StatoPulsanteFoto): PlainMessageKey | undefined {
  if (!stato.isTrial && !stato.isSignedIn) {
    return 'fotoCampione.signedOut';
  }
  if (!stato.isTrial && !stato.isLinked) {
    return 'fotoCampione.unlinked';
  }
  if (stato.versione === 'illeggibile') {
    return 'fotoCampione.versionUnreadable';
  }
  if (stato.versione === 'nessuna') {
    return 'fotoCampione.notDelivered';
  }
  if (stato.versione === 'in-lettura') {
    return 'fotoCampione.versionLoading';
  }
  if (!stato.hasModel) {
    return stato.isBuilding ? 'fotoCampione.modelBuilding' : 'fotoCampione.noModel';
  }
  if (!stato.hasSentMesh) {
    return 'fotoCampione.versionLoading';
  }
  if (stato.schermoUguale === false) {
    return 'fotoCampione.changedSinceDelivery';
  }
  if (stato.isPriceLoading) {
    return 'fotoCampione.priceLoading';
  }
  if (!stato.hasPrice) {
    return 'fotoCampione.priceMissing';
  }
  return stato.isReady ? 'fotoCampione.alreadyReady' : undefined;
}

/**
 * The screen against the sent version: its content first, the shape only when the content says nothing.
 *
 * @param contenuto - `stessoContenutoInviato`.
 * @param forma - `stessaForma(…).stessa`, `undefined` while it cannot be told.
 * @returns Whether the screen is the sent version, `undefined` while unknown.
 */
export const schermoComeInviata = (contenuto: true | undefined, forma: boolean | undefined): boolean | undefined =>
  contenuto ?? forma;
