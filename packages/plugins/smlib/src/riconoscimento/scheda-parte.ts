import { z } from 'zod';

/**
 * La scheda della parte (specifica D2 §2.1): ciò che il CAD ricostruisce dall'indirizzo `/cad/nuovo?…` di Sinopia e
 * manda al classificatore. Solo riferimenti allo storage privato (`creator-private`), mai URL pubblici o firmati.
 */

const riquadro = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** Le verticali di Sinopia (`projects.vertical`). @public */
export const verticali = ['footwear', 'leather_goods', 'atelier', 'accessories'] as const;

/** Da dove viene il tipo della parte. @public */
export const fontiTipo = ['utente', 'libreria', 'catalogo', 'riconosci_parti'] as const;

/** Da dove viene la scala nota (§2.5, nell'ordine di priorità). @public */
export const tipiScala = ['misura', 'libreria', 'catalogo', 'taglia', 'forma'] as const;

/** Schema della scheda della parte. @public */
export const schedaParteSchema = z.object({
  versione: z.literal(1),
  progetto: z.object({ id: z.uuid(), verticale: z.enum(verticali) }),
  immagine: z.object({
    bucket: z.literal('creator-private'),
    path: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[\da-f]{64}$/u),
    larghezzaPx: z.number().int().positive(),
    altezzaPx: z.number().int().positive(),
  }),
  parte: z.object({
    id: z.string().min(1).max(200),
    nome: z.string().max(200),
    etichetta: z.string().max(200),
    materiale: z.string().max(200).optional(),
    colore: z.string().max(200).optional(),
    /** X0, y0, x1, y1 in 0–1000. */
    box: riquadro,
    /** 0–1000, già orientato come fa il client di Sinopia (`orientaContorno`). */
    contorno: z
      .array(z.tuple([z.number(), z.number()]))
      .max(2000)
      .optional(),
  }),
  maschera: z
    .object({ bucket: z.literal('creator-private'), path: z.string().max(1024), origine: z.enum(['sam', 'contorno']) })
    .optional(),
  tipo: z.object({ partType: z.string().min(1).max(64), fonte: z.enum(fontiTipo) }).optional(),
  scala: z
    .object({
      tipo: z.enum(tipiScala),
      valoreMm: z.number().positive(),
      cosa: z.string().max(80),
      pxPerMm: z.number().positive().optional(),
      confidenza: z.number().min(0).max(1),
    })
    .optional(),
  altreParti: z
    .array(z.object({ id: z.string().max(200), etichetta: z.string().max(200), box: riquadro }))
    .max(50)
    .default([]),
});

/** La scheda della parte. @public */
export type SchedaParte = z.infer<typeof schedaParteSchema>;
