/** Frontmatter `description`, shared with the catalog row (the person sees it beside `/sinopia-varianti`). */
export const sinopiaVariantiSkillDescription =
  'Propone 2–3 varianti di un modello di famiglia (fibbia, tacco, anello…) come insiemi di parametri che il CAD mostra affiancati.';

/** Frontmatter `when_to_use`, shared with the catalog row. */
export const sinopiaVariantiSkillWhenToUse =
  'Usala quando la persona chiede varianti, alternative o idee su un modello costruito da una famiglia parametrica.';

/**
 * SinopiaCAD's variants in chat (D5): the agent writes sets of parameters in a `sinopia-varianti` block, the CAD
 * evaluates them in its worker and shows the variants card (`#lib/assistant-variants-marker.ts` reads the block).
 */
export const sinopiaVariantiSkillMarkdown = `---
name: sinopia-varianti
description: ${sinopiaVariantiSkillDescription}
source: system
version: 1.0.0
when_to_use: ${sinopiaVariantiSkillWhenToUse}
enabled: true
---

# Varianti di una famiglia

Un modello di famiglia ha nel \`main.ts\` la riga \`export const famiglia = { id, versione, variante }\` e i \`defaultParams\` annidati per pezzo. Per proporre varianti **non modificare i file**: scrivi nella risposta un blocco così.

\`\`\`sinopia-varianti
{ "famiglia": "fibbia", "insiemi": [{ "titolo": "Più leggera", "motivo": "Sezione 2,2 × 2 mm: un quinto di zama in meno.", "parametri": { "telaio": { "sezioneLarghezza": 2.2, "sezioneSpessore": 2 } } }] }
\`\`\`

- Da 2 a 3 insiemi; titolo di due o tre parole; motivo in una riga, con i numeri che contano.
- \`parametri\` contiene solo le chiavi che cambi, annidate come in \`defaultParams\`, in mm e gradi. Chiavi sconosciute o derivate si ignorano; i limiti della famiglia valgono comunque.
- I valori in \`.tau/parameters/\` sono del designer: una variante non li cambia.
- Resta nella stessa famiglia e nella stessa variante; per cambiare famiglia chiedi prima.
- Il CAD costruisce, verifica e rende ogni insieme e mostra le card con «Usa questa» e «Scarta»: non applicare tu i parametri e non ripetere i numeri nel testo, che resta di una o due frasi.
`;
