import { baseUrl } from '#lib/base-path.js';

/**
 * Where SinopiaCAD sends the person back into Sinopia (the app), for the gestures that continue there: «Porta nel
 * Creator» and «Fai lo shooting». Served under `/cad` on sinopialab.com the CAD shares Sinopia's origin, so a path is
 * enough (same session, same tab); on its own origins (development, previews) the address is sinopialab.com's.
 *
 * The addresses are the ones Sinopia reads: `/creator/<project>?cadModel=<model>` (the canvas adds the model's image as
 * a reference) and `/shooting/<project>?asset=<photo>&cad=<model>` (`linkShootingDaCad` in Sinopia).
 */

const sinopiaOrigin = 'https://sinopialab.com';
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

const sinopiaUrl = (path: string): string => (baseUrl() === '/cad/' ? path : `${sinopiaOrigin}${path}`);

/**
 * The Creator of the model's Sinopia project, bringing the model in as an image.
 *
 * @param projectId - The Sinopia project (`projects.id`).
 * @param modelId - The CAD model (`cad_models.id`).
 * @returns The address, or undefined when an id is malformed.
 */
export function sinopiaCreatorUrl(projectId: string, modelId: string): string | undefined {
  if (!uuidPattern.test(projectId) || !uuidPattern.test(modelId)) {
    return undefined;
  }
  return sinopiaUrl(`/creator/${projectId.toLowerCase()}?cadModel=${modelId.toLowerCase()}`);
}

/**
 * The Shooting Studio of the model's Sinopia project, starting from a sample photo and with the model as its 3D.
 *
 * @param projectId - The Sinopia project.
 * @param photoAssetId - The sample photo (`assets.id`) to start from.
 * @param modelId - The CAD model.
 * @returns The address, or undefined when an id is malformed.
 */
export function sinopiaShootingUrl(projectId: string, photoAssetId: string, modelId: string): string | undefined {
  if (!uuidPattern.test(projectId) || !uuidPattern.test(photoAssetId) || !uuidPattern.test(modelId)) {
    return undefined;
  }
  const query = new URLSearchParams({ asset: photoAssetId.toLowerCase(), cad: modelId.toLowerCase() });
  return sinopiaUrl(`/shooting/${projectId.toLowerCase()}?${query.toString()}`);
}
