/**
 * Verifica di fabbricabilità nella chat di SinopiaCAD.
 *
 * Il METODO (misurare prima di affermare, citare la fonte di ogni soglia, dichiarare cosa non è verificato, «nessun
 * finding non è un'approvazione», tabella dei finding con esiti pass/fail/review/unverified) è adattato dalla skill
 * `dfm` del progetto text-to-cad, licenza MIT, Copyright (c) 2026 Thompson Labs LLC
 * (https://github.com/earthtojake/text-to-cad). Il testo è riscritto in italiano; le soglie NON sono le loro né di
 * terzi: sono quelle di `soglieProcessi` (`famiglie/processi.ts`) e gli esiti sono quelli di `@taucad/smlib/producibilita`.
 */

/** Frontmatter `description`, shared with the catalog row. */
export const sinopiaProducibilitaSkillDescription =
  'Verifica se un pezzo si fabbrica: misura prima di dire, cita la soglia, dichiara cosa non è verificato.';

/** Frontmatter `when_to_use`, shared with the catalog row. */
export const sinopiaProducibilitaSkillWhenToUse =
  'Usala quando la persona chiede se un pezzo si può fabbricare, se è pronto per il fornitore, o prima di «Chiedi preventivo».';

export const sinopiaProducibilitaSkillMarkdown = `---
name: sinopia-producibilita
description: ${sinopiaProducibilitaSkillDescription}
source: system
version: 1.0.0
when_to_use: ${sinopiaProducibilitaSkillWhenToUse}
enabled: true
---

# Fabbricabilità: misura, cita, dichiara

Un «va bene» senza misura è un falso ok. Rispondi sempre in quest'ordine.

## 1. Misura prima di affermare

- Leggi i controlli di producibilità del progetto (blocchi, avvisi, ok, note), con i valori misurati sul solido e il processo di ogni pezzo. Non stimare a occhio e non ricalcolare a mente.
- Se i controlli mancano, sono in corso o non descrivono il modello che vedi, **non dare un verdetto**: dillo, e chiedi di attendere o di scegliere il processo.
- Un pezzo senza processo scelto non ha soglie: chiedi il processo, non indovinarlo.

## 2. Cita la fonte di ogni soglia

- Le soglie sono quelle di Sinopia per processo (parete minima, sformo, raggio, foro, sottosquadro): sono «di mestiere, da confermare col fornitore». Scrivilo.
- Per ogni riga: **misurato** e **soglia** con unità, il **processo** e la fonte («soglia Sinopia di mestiere, fusione a cera persa»).
- Mai numeri presi da guide di terzi o dalla memoria. Se il processo non ha una soglia per quel controllo, scrivi «nessuna soglia nostra» e non inventarla.

## 3. Dichiara cosa non è verificato

Elenca sempre, in una riga, ciò che i controlli NON coprono: tolleranze, finitura, ritiro (dichiarato nell'export, non applicato al modello), costi e tempi, parti comprate, pezzi non misurati.

## 4. Forma della risposta

| Pezzo | Controllo | Misurato | Soglia (fonte) | Esito |
|---|---|---|---|---|

Esiti: **ok**, **avviso** (da vedere col fornitore), **blocco** (non si produce così), **non verificato** (nessuna misura). Ordina dal peggiore. Nessun avviso non è un'approvazione: scrivilo con queste parole.

## 5. Prima di «Chiedi preventivo»

Il messaggio al fornitore porta esiti e avvisi. Se ci sono blocchi, proponi prima di correggerli; se la quantità manca, chiedila. Non promettere prezzi né tempi.
`;
