/** Frontmatter `description`, shared with the catalog row (the person sees it beside `/sinopia-immagine-cad`). */
export const sinopiaImmagineCadSkillDescription =
  'Costruisce il CAD di un gioiello o accessorio da immagini o da una descrizione, a pezzi e con misure modificabili.';

/** Frontmatter `when_to_use`, shared with the catalog row. */
export const sinopiaImmagineCadSkillWhenToUse =
  'Usala quando arrivano immagini di riferimento o la descrizione di un pezzo da modellare, e per le modifiche a un pezzo già costruito.';

/**
 * SinopiaCAD's image-to-CAD know-how for jewelry and accessories, ported from the founder's agent brief
 * (`sinopiacad-progetti/CLAUDE.md`). How to speak to the person lives in the system prompt, not here.
 */
export const sinopiaImmagineCadSkillMarkdown = `---
name: sinopia-immagine-cad
description: ${sinopiaImmagineCadSkillDescription}
source: system
version: 1.1.0
when_to_use: ${sinopiaImmagineCadSkillWhenToUse}
enabled: true
---

# Dall'immagine al CAD

Se il progetto non ha un motore, sceglilo prima con \`create-model\`; poi attiva la skill \`cad-*\` del motore e cerca lì una funzione prima di dire che non esiste. Gli esempi qui sono per SMLib, il motore di default.

## Lavoro

1. **Scomponi.** Elenca i pezzi fisici: metallo (castoni, steli, anelli, cornici, perni), pietre, parti comprate (catene, chiusure, moschettoni) che non si modellano ma si annotano.
2. **Scala.** Àncorati a una misura standard del mestiere — pietre calibrate (brillante 1–3 mm, marquise 8×4, goccia 6×4), anellini 2–4 mm, spessori del metallo 0,4–1,5 mm — e ricava il resto in proporzione all'immagine.
3. **Viste nascoste.** Se l'immagine è di fronte, decidi spessori e profili da come si fa davvero quel pezzo in oreficeria. Altre viste o riferimenti vengono prima di ogni ipotesi.
4. **Costruisci a pezzi.** Un pezzo = un solido valido con un nome italiano chiaro («Castone Marquise», «Rametto Sinistro»). Contorni esatti con archi, linee e spline, mai poligoni a scaletta.
5. **Controlla e correggi.** Dopo ogni modifica: \`evaluate_model\`, poi \`screenshot\` con \`multi_angle\` (fronte, fianchi, sopra) e confronta con le immagini di riferimento: proporzioni, posizioni, numero di elementi. Al massimo 3 giri, poi consegna e di' che cosa resta diverso.
6. **Misure modificabili.** Ciò che il designer vorrà cambiare (lunghezze, diametri, spessori, distanze, numero di elementi) va nei parametri, con limiti sensati, così lo cambia dalle Misure senza di te.

Alla fine scrivi al massimo 5 righe: che cosa hai costruito o cambiato, le ipotesi sulle parti che dalle immagini non si vedono, le misure da controllare. Non chiedere il permesso per ogni passo: fai la scelta più ragionevole e di' quale ipotesi hai preso.

## Modifiche

Arrivano scritte, a voce o con una nuova immagine, a volte su un pezzo selezionato nella vista. Cambia solo quello che chiedono: se basta una misura, cambiala con \`apply_parameter_operation\`; se cambia la forma, modifica il pezzo e riverifica tutto il modello. Poi rispondi in 1–3 righe.

## Forma del modello

\`defaultParams\` è raggruppato per pezzo, con chiavi italiane in camelCase: le Misure mostrano un gruppo per pezzo e ricavano le etichette dalle chiavi (\`marquise.lunghezza\` → «Marquise › Lunghezza»). I limiti min/max stanno in \`limiti\`; \`main\` riporta dentro i limiti i valori fuori scala, così il modello non si rompe mai.

\`\`\`ts
import { Pos, Cylinder, Circle, Spline, sweep, loft, fromSmb, toSmb } from '@classcad/smlibwasm';

// mm. Piano frontale XY (Y in alto), Z verso chi guarda.
// Nomi dei pezzi e chiavi dei parametri devono corrispondere (spazi e underscore sono equivalenti).
export const defaultParams = {
  stelo: { lunghezza: 15, spessore: 1.4 },
  marquise: { lunghezza: 8, larghezza: 4 },
  finiture: { granulatura: 1 },
};
// Ipotesi esplicite: percorso del valore → motivo, nella lingua dell'interfaccia.
export const ipotesi = { 'stelo.spessore': 'La foto non mostra lo spessore: verificare 1,4 mm.' };
const limiti = { stelo: { lunghezza: [10, 25], spessore: [0.8, 2] } /* … */ };

function costruisci(p) {
  // restituisce [{ nome, forma, colore, ruolo: 'metallo' | 'pietra' }]
}

export default function main(p = defaultParams) {
  return costruisci(entroLimiti(p, limiti)).map(({ nome, forma, colore, ruolo }) => ({
    name: nome,
    shape: fromSmb(toSmb(forma)),
    color: colore,
    metalness: ruolo === 'metallo' ? 0.9 : 0.1,
    roughness: ruolo === 'metallo' ? 0.25 : 0.05,
    ...(ruolo === 'metallo' ? { density: 15.5 } : {}),
  }));
}
\`\`\`

Colori: oro giallo \`#d4ab62\`, oro rosa \`#d99a85\`, oro bianco o argento \`#c9ced3\`, diamante \`#e3edf2\`. \`density\` è in g/cm³ (oro 18 kt 15,5; argento 925 10,4) e dà il peso del pezzo: per l'oro 18 kt, volume del metallo in mm³ × 0,0155 g.

## Ipotesi e valori del designer

Per SMLib esporta \`ipotesi\` come oggetto percorso → motivo (es. \`{ 'stelo.spessore': 'Non visibile nella foto' }\`), oppure come elenco di percorsi. Sono accettati anche puntatori JSON come \`/stelo/spessore\`. Il kernel li porta nelle descrizioni dello schema con il marcatore \`[sinopia:assumed]\`; non aggiungerli a \`defaultParams\` né al record dei valori. La UI mostra «Ipotesi: controlla» finché il valore non è fissato dal designer. Non inventare un motivo su una misura ricavata da un riferimento certo.

I valori in \`.tau/parameters/\` sono scelte esplicite e mostrano il lucchetto: non cambiarli salvo richiesta della persona. Per modifiche autonome aggiorna i valori iniziali nel modello e conserva i valori fissati. I nomi restituiti e le chiavi di primo livello devono coincidere, ignorando spazi, underscore e maiuscole; non accorpare castone e pietra. Usa nomi nella lingua dell'interfaccia. Il peso appare solo quando il solido ha volume valido e densità dichiarata; non chiamare oro 18 kt un metallo di densità sconosciuta.

## Trappole SMLib già incontrate

- Normalizza ogni pezzo con \`fromSmb(toSmb(forma))\` prima di restituirlo: senza, viste ed esportazioni possono sbagliare.
- Prima di unire con \`fuse\`, fai compenetrare davvero i solidi: perline di granulatura solo tangenti restano solidi separati, e un pezzo con più solidi è un errore. Falle affondare almeno di un terzo del raggio.
- \`sweep(Circle(r), Spline(...))\` va bene per fili e rametti a sezione tonda; controlla che il risultato sia un solo solido valido.
- \`Edge.pointAt(t)\` e \`tangentAt(t)\`: \`t\` è la frazione di lunghezza, da 0 a 1.
- Pietre: cintura sottile estrusa più corona e padiglione con \`loft\` rigato. Il castone è un anello con un labbro che trattiene la pietra, aperto dietro.
- La granulatura (tante sfere) rallenta il calcolo: mettila dietro un parametro 0/1.
`;
