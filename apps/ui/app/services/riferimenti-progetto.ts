import { z } from 'zod';
import {
  leggiRecordRiconoscimento,
  percorsoMaschera,
  percorsoRiconoscimento,
} from '#services/riconoscimento-record.js';
import { sinopiaCadLinkPath, sinopiaCadLinkSchema } from '#services/sinopia-cad.js';
import { attachmentKind } from '#utils/attachment.utils.js';
import type { AttachmentReference } from '#utils/attachment.utils.js';

/**
 * Le immagini da cui nasce un modello, dove le tiene il progetto: la cartella `riferimenti/`, accanto al modello.
 *
 * Ci arrivano da tre strade: la foto della parte riconosciuta da `/cad/nuovo` (con la sua maschera), le immagini scelte
 * da Sinopia nella home (`sinopia-<id>.jpg`, con `misure.json`) e, da qui in poi, le immagini caricate o incollate nella
 * home, copiate dal primo messaggio. Sono file autore: entrano nelle versioni e nella copia del modello su Sinopia, così
 * restano dopo un ricaricamento e si ritrovano aprendo il modello da un altro computer. La maschera e `misure.json` non
 * sono riferimenti da guardare.
 */

/** La cartella dei riferimenti, relativa alla radice del progetto. */
export const cartellaRiferimenti = 'riferimenti';

const tipiPerEstensione: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const estensioniPerTipo: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Da dove viene un riferimento: la foto riconosciuta, un'immagine di Sinopia, un'immagine caricata o incollata. */
export type OrigineRiferimento = 'foto' | 'sinopia' | 'caricata';

/** Un'immagine di riferimento del progetto. */
export type RiferimentoProgetto = Readonly<{
  /** Il percorso relativo alla radice del progetto, `riferimenti/<nome>`. */
  percorso: string;
  /** Il tipo dell'immagine, dall'estensione. */
  tipo: string;
  origine: OrigineRiferimento;
  /** Che cosa ritrae, quando si sa: l'etichetta della parte riconosciuta o il nome del pezzo della Libreria. */
  dettaglio?: string;
  /** La maschera della parte riconosciuta, quando c'è: mette in evidenza ciò che è diventato il modello. */
  maschera?: string;
}>;

/** I riferimenti del progetto e il progetto Sinopia a cui appartiene il modello, se è collegato. */
export type RiferimentiLetti = Readonly<{
  riferimenti: readonly RiferimentoProgetto[];
  progettoSinopia?: Readonly<{ id: string; userId: string }>;
}>;

const misureSchema = z.array(z.object({ filename: z.string(), name: z.string().optional().nullable() }).loose());

/** Ciò che serve per dare un nome ai riferimenti: il record del riconoscimento e le misure delle immagini di Sinopia. */
export type ContestoRiferimenti = Readonly<{
  /** La parte del riconoscimento: il suo id dà il nome della foto, la sua etichetta dice che cosa ritrae. */
  parte?: Readonly<{ id: string; etichetta: string }>;
  /** I nomi dei pezzi della Libreria scelti da Sinopia, per nome del file. */
  nomi?: Readonly<Record<string, string>>;
}>;

const estensione = (nome: string): string => nome.slice(nome.lastIndexOf('.') + 1).toLowerCase();
const base = (nome: string): string => nome.slice(0, nome.lastIndexOf('.'));
const suffissoMaschera = '.maschera.png';
/** La foto riconosciuta prima, poi le immagini scelte da Sinopia, poi quelle caricate. */
const ordine: Readonly<Record<OrigineRiferimento, number>> = { foto: 0, sinopia: 1, caricata: 2 };

/**
 * I riferimenti da guardare fra i file di `riferimenti/`: le immagini, senza maschere né `misure.json`. Prima la foto
 * riconosciuta, poi le immagini di Sinopia, poi quelle caricate; a pari origine in ordine di nome, così l'ordine non
 * dipende dal disco.
 *
 * @param nomi - I nomi dei file della cartella.
 * @param contesto - La parte riconosciuta e i nomi della Libreria, quando ci sono.
 * @returns I riferimenti, il primo è quello che si apre.
 */
export function riferimentiDaFile(nomi: readonly string[], contesto: ContestoRiferimenti = {}): RiferimentoProgetto[] {
  const presenti = new Set(nomi);
  const baseFoto = contesto.parte
    ? percorsoMaschera(contesto.parte.id).slice(cartellaRiferimenti.length + 1, -suffissoMaschera.length)
    : undefined;
  const riferimenti = nomi
    .filter(
      (nome) => !nome.toLowerCase().endsWith(suffissoMaschera) && tipiPerEstensione[estensione(nome)] !== undefined,
    )
    .toSorted((primo, secondo) => primo.localeCompare(secondo))
    .map((nome): RiferimentoProgetto => {
      const maschera = `${base(nome)}${suffissoMaschera}`;
      const haMaschera = presenti.has(maschera);
      const percorso = `${cartellaRiferimenti}/${nome}`;
      const tipo = tipiPerEstensione[estensione(nome)]!;
      if (haMaschera || (baseFoto !== undefined && base(nome) === baseFoto)) {
        const dettaglio = baseFoto !== undefined && base(nome) === baseFoto ? contesto.parte?.etichetta.trim() : '';
        return {
          percorso,
          tipo,
          origine: 'foto',
          ...(dettaglio ? { dettaglio } : {}),
          ...(haMaschera ? { maschera: `${cartellaRiferimenti}/${maschera}` } : {}),
        };
      }
      const nomeLibreria = contesto.nomi?.[nome]?.trim();
      return {
        percorso,
        tipo,
        origine: /^sinopia-[\da-f-]+\.\w+$/iu.test(nome) ? 'sinopia' : 'caricata',
        ...(nomeLibreria ? { dettaglio: nomeLibreria } : {}),
      };
    });
  return riferimenti.toSorted((primo, secondo) => ordine[primo.origine] - ordine[secondo.origine]);
}

/** Ciò che la lettura chiede al disco del progetto. */
export type FileRiferimenti = Readonly<{
  exists: (path: string) => Promise<boolean>;
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
}>;

const leggiTesto = async (files: FileRiferimenti, path: string): Promise<string | undefined> => {
  try {
    return (await files.exists(path)) ? new TextDecoder().decode(await files.readFile(path)) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Legge i riferimenti di un progetto dal suo disco: la cartella, il record del riconoscimento (l'etichetta della parte)
 * e `misure.json` (i nomi della Libreria), più il progetto Sinopia del collegamento. Un file illeggibile toglie solo
 * il suo nome, mai il riferimento; senza cartella non c'è nulla da mostrare.
 *
 * @param files - Il disco del progetto.
 * @param radice - La radice del progetto, `/projects/<id>`.
 * @returns I riferimenti e il progetto Sinopia, se il modello ne ha uno.
 */
export async function leggiRiferimentiProgetto(files: FileRiferimenti, radice: string): Promise<RiferimentiLetti> {
  const cartella = `${radice}/${cartellaRiferimenti}`;
  if (!(await files.exists(cartella))) {
    return { riferimenti: [] };
  }
  const nomi = await files.readdir(cartella);
  const [record, misure, collegamento] = await Promise.all([
    leggiTesto(files, `${radice}/${percorsoRiconoscimento}`),
    leggiTesto(files, `${cartella}/misure.json`),
    leggiTesto(files, `${radice}/${sinopiaCadLinkPath}`),
  ]);
  const lettura = leggiRecordRiconoscimento(record);
  const parte =
    lettura.stato === 'ok'
      ? {
          id: lettura.record.schedaParte.parte.id,
          etichetta: lettura.record.schedaParte.parte.etichetta || lettura.record.schedaParte.parte.nome,
        }
      : undefined;
  let nomiLibreria: Record<string, string> | undefined;
  try {
    const voci = misure === undefined ? undefined : misureSchema.safeParse(JSON.parse(misure));
    nomiLibreria = voci?.success
      ? Object.fromEntries(voci.data.flatMap((voce) => (voce.name ? [[voce.filename, voce.name]] : [])))
      : undefined;
  } catch {
    nomiLibreria = undefined;
  }
  let progettoSinopia: RiferimentiLetti['progettoSinopia'];
  try {
    const link = collegamento === undefined ? undefined : sinopiaCadLinkSchema.safeParse(JSON.parse(collegamento));
    progettoSinopia = link?.success ? { id: link.data.projectId, userId: link.data.userId } : undefined;
  } catch {
    progettoSinopia = undefined;
  }
  return {
    riferimenti: riferimentiDaFile(nomi, {
      ...(parte ? { parte } : {}),
      ...(nomiLibreria ? { nomi: nomiLibreria } : {}),
    }),
    ...(progettoSinopia ? { progettoSinopia } : {}),
  };
}

/** Un nome di file sicuro per `riferimenti/`: niente cartelle, niente caratteri strani, l'estensione del tipo. */
const nomeSicuro = (nome: string | undefined, tipo: string, indice: number): string => {
  const estensioneTipo = estensioniPerTipo[tipo] ?? 'png';
  const radice = (nome ?? '')
    .split(/[/\\]/u)
    .at(-1)!
    .replace(/\.[^.]*$/u, '')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\w-]+/gu, '-')
    .slice(0, 60)
    .replaceAll(/^-+|-+$/gu, '');
  // I punti diventano trattini: un'immagine caricata non può chiamarsi come la maschera di una foto riconosciuta.
  return `${radice || `immagine-${indice + 1}`}.${estensioneTipo}`;
};

/**
 * Le immagini caricate o incollate nel primo messaggio, come file di `riferimenti/` del progetto nuovo. Le immagini già
 * copiate da Sinopia (stesso nome) restano quelle; i documenti non sono riferimenti. Due nomi uguali prendono un
 * numero.
 *
 * @param allegati - Gli allegati del primo messaggio.
 * @param leggi - Legge i byte di un allegato dalla bozza (undefined se non ci sono più).
 * @param giaPresenti - I file che il progetto ha già, per non copiare due volte la stessa immagine.
 * @returns I file da aggiungere al progetto.
 */
export async function riferimentiDaAllegati(
  allegati: readonly AttachmentReference[],
  leggi: (allegato: AttachmentReference) => Promise<Uint8Array<ArrayBuffer> | undefined>,
  giaPresenti: Readonly<Record<string, unknown>> = {},
): Promise<Record<string, { content: Uint8Array<ArrayBuffer> }>> {
  const file: Record<string, { content: Uint8Array<ArrayBuffer> }> = {};
  const usati = new Set(Object.keys(giaPresenti));
  const immagini = allegati.filter(
    (allegato) =>
      attachmentKind(allegato.mediaType) === 'image' &&
      estensioniPerTipo[allegato.mediaType] !== undefined &&
      !(allegato.filename !== undefined && usati.has(`${cartellaRiferimenti}/${allegato.filename}`)),
  );
  for (const [indice, allegato] of immagini.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- one image at a time: the bytes are already on this device, at most a few MB each
    const bytes = await leggi(allegato);
    if (bytes === undefined) {
      continue;
    }
    const nome = nomeSicuro(allegato.filename, allegato.mediaType, indice);
    let percorso = `${cartellaRiferimenti}/${nome}`;
    for (let numero = 2; usati.has(percorso); numero++) {
      percorso = `${cartellaRiferimenti}/${base(nome)}-${numero}.${estensione(nome)}`;
    }
    usati.add(percorso);
    file[percorso] = { content: bytes };
  }
  return file;
}
