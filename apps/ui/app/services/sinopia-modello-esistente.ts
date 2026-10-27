import type { ProjectSlugs } from '#utils/project-url.utils.js';
import {
  findSinopiaCadModelForPart,
  getSinopiaCadModel,
  sinopiaCadLocalId,
  sinopiaCadSourceHint,
} from '#services/sinopia-cad.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';

/**
 * «Apri nel CAD» on a part that already became a model reopens it instead of building it again (and paying the
 * recognition again): this finds that model. The database's origin columns answer first; before they exist (the
 * migration waits for Marko's OK), or before the model's first save, the device remembers which model the part became.
 */

/** The Sinopia project, image and part a piece starts from. */
export type OrigineSinopia = Readonly<{ projectId: string; assetId: string; partId: string }>;

/** A model the part already has: how to name it and, when this device holds it, where to open it. */
export type ModelloEsistente = Readonly<{
  modelId: string;
  name: string;
  /** The local project, when this device holds it: opened directly. Otherwise the home opens it from Sinopia. */
  slugs?: ProjectSlugs;
}>;

type ProgettoLocale = Readonly<{
  projectId: string;
  manifest: Readonly<{ name: string }>;
  library: Readonly<{ deletedAt?: number }>;
  slugs?: ProjectSlugs;
}>;

/**
 * The model this part already became, or undefined.
 *
 * @param input - The origin, the account, the projects this device holds and how to read a local project's link.
 * @returns The model to offer, or undefined to build the piece.
 */
export async function cercaModelloEsistente(input: {
  origine: OrigineSinopia;
  userId: string;
  progettiLocali: () => Promise<readonly ProgettoLocale[]>;
  leggiLink: (localProjectId: string) => Promise<SinopiaCadLink | undefined>;
}): Promise<ModelloEsistente | undefined> {
  const { origine, userId } = input;
  const remoto = await findSinopiaCadModelForPart(origine).catch(() => undefined);
  const modelId = remoto?.id ?? sinopiaCadSourceHint.get({ userId, ...origine });
  if (modelId === undefined) {
    return undefined;
  }
  const localId = sinopiaCadLocalId.get(userId, modelId);
  const progetti = await input.progettiLocali().catch(() => []);
  const locale = progetti.find(
    (progetto) => progetto.projectId === localId && progetto.library.deletedAt === undefined,
  );
  if (locale?.slugs !== undefined) {
    const link = await input.leggiLink(localId).catch(() => undefined);
    // The device's copy counts only while it is still this model, in this project (it may have been moved since).
    if (link?.modelId === modelId && link.userId === userId && link.projectId === origine.projectId) {
      return { modelId, name: remoto?.name ?? locale.manifest.name, slugs: locale.slugs };
    }
  }
  if (remoto !== undefined) {
    return { modelId, name: remoto.name };
  }
  // Only the device's memory: the model counts if Sinopia still has it in this project.
  const riga = await getSinopiaCadModel({ modelId, projectId: origine.projectId, userId, baseRevisionId: null }).catch(
    () => undefined,
  );
  return riga === undefined ? undefined : { modelId, name: riga.name };
}
