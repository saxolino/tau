/**
 * Sinopia's «Fai lo shooting» on a model with no sample photo yet sends the person to the CAD to make one:
 * `/cad/?project=<p>&model=<m>&sezione=foto`. The home opens the model (and takes the parameters off the address); this
 * one-shot request, per tab and per model, tells the photo section to come into view when the model's page opens.
 */

const key = (modelId: string): string => `sinopia:apri-foto:${modelId}`;

/**
 * Ask for the sample-photo section of a model.
 *
 * @param modelId - The CAD model (`cad_models.id`).
 */
export function rememberSampleSectionRequest(modelId: string): void {
  try {
    sessionStorage.setItem(key(modelId), '1');
  } catch {
    /* Without storage the model still opens; the section is one scroll away. */
  }
}

/**
 * Whether the photo section was asked for this model, consuming the request.
 *
 * @param modelId - The CAD model.
 * @returns True once per request.
 */
export function takeSampleSectionRequest(modelId: string): boolean {
  try {
    const asked = sessionStorage.getItem(key(modelId)) === '1';
    if (asked) {
      sessionStorage.removeItem(key(modelId));
    }
    return asked;
  } catch {
    return false;
  }
}
