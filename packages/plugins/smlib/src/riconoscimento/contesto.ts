import { z } from 'zod';
import { facceVista } from '#famiglie/viste.js';

/**
 * Il contesto della richiesta di riconoscimento (contratto v3, piano «viste ortogonali» §4.1): ciò che il CAD sa della
 * parte senza chiamate (proporzioni e visibilità dai riquadri dell'analisi salvata e dalla maschera) e quali viste
 * generate accompagnano la foto. Viaggia accanto alla scheda della parte, che resta la v1: una funzione vecchia la
 * convalida ancora e ignora il contesto. Lo schema JSON gemello sta nel contratto (`schemaContesto`, `limitiContesto`).
 */

/** I rapporti misurati sulla foto: altezza e larghezza della parte sulla lunghezza del prodotto, altezza su altezza. @public */
export const chiaviProporzione = ['altezza_su_lunghezza', 'larghezza_su_lunghezza', 'altezza_su_altezza'] as const;

/** Perché una parte non si vede intera: tagliata dal bordo, troppo piccola, coperta da un'altra. @public */
export const motiviVisibilita = ['tagliata_bordo', 'piccola', 'coperta'] as const;

/** Il ruolo di una vista generata: la principale (piatta, completa) o una di controllo. @public */
export const ruoliVista = ['principale', 'controllo'] as const;

/** Schema del contesto della richiesta (contratto v3). @public */
export const contestoRiconoscimentoSchema = z.strictObject({
  versione: z.literal(1),
  proporzioni: z
    .strictObject({
      rapporti: z
        .array(z.strictObject({ chiave: z.enum(chiaviProporzione), valore: z.number().gt(0).max(5) }))
        .max(chiaviProporzione.length),
      /** 0–1: alta solo se i riquadri formano una vista di fianco completa del prodotto. */
      affidabilita: z.number().min(0).max(1),
      /** Quante parti formano il «prodotto» (l'unione dei loro riquadri). */
      parti: z.number().int().min(0).max(100),
    })
    .optional(),
  visibilita: z
    .strictObject({
      stato: z.enum(['intera', 'parziale']),
      motivi: z.array(z.enum(motiviVisibilita)).max(motiviVisibilita.length),
    })
    .optional(),
  /** Descrive `immagini.principale` e `immagini.controllo`: una voce per ogni immagine, una per ruolo. */
  viste: z
    .array(z.strictObject({ ruolo: z.enum(ruoliVista), faccia: z.enum(facceVista) }))
    .max(ruoliVista.length)
    .optional(),
});

/** Il contesto della richiesta. @public */
export type ContestoRiconoscimento = z.infer<typeof contestoRiconoscimentoSchema>;
