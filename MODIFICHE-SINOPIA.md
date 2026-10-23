# Modifiche di Sinopia

SinopiaCAD è una versione modificata di [Tau](https://github.com/taucad/tau)
(licenza Apache-2.0), realizzata da Sinopia ([sinopialab.com](https://sinopialab.com)).
Questo file elenca i file che Sinopia ha cambiato, come chiede la sezione 4(b)
della licenza Apache, Versione 2.0. Le note di copyright e di licenza di Tau
restano intatte in `license` e `NOTICE`.

## 23 ottobre 2026 — marchio SinopiaCAD

Logo, colori, caratteri, nome visibile e pagine legali di Sinopia al posto di quelli di Tau.
Restano invariati nomi interni, pacchetti `@taucad/*`, URI `tau://`, cartella `.tau/`,
variabili `TAU_*`, protocolli e prompt degli agenti.

### Note legali

- `NOTICE` — aggiunta la sezione «SinopiaCAD — modified version of Tau».
- `MODIFICHE-SINOPIA.md` — questo elenco (nuovo).

### Colori, raggi e caratteri

- `packages/ui/src/styles/tokens.css` — palette Sinopia (rosso sinopia come accento, avorio e
  carbone caldi come neutri tramite `--hue-paper`/`--c-paper`), raggi più stretti
  (`--radius-lg` = 0.625rem), Inter e JetBrains Mono in `--font-sans`/`--font-mono`.
- `apps/ui/app/styles/global.css` — `@font-face` di Inter e JetBrains Mono al posto di Geist.
- `apps/ui/app/styles/global.styles.ts` — precarica Inter.
- `apps/ui/app/lib/monaco.lib.client.ts` — l'editor attende JetBrains Mono prima di misurare.
- `apps/ui/app/constants/color.constants.ts` — tonalità predefinita 33° (rosso sinopia).
- `apps/ui/public/fonts/Inter-Latin-Variable.woff2`, `Inter-LatinExt-Variable.woff2`,
  `JetBrainsMono-Latin-Variable.woff2`, `JetBrainsMono-LatinExt-Variable.woff2`, `OFL.txt` — nuovi.
- `apps/ui/app/styles/global.test.ts` — i controlli seguono la palette Sinopia e i nuovi raggi.
- `docs/policy/color-policy.md`, `docs/policy/ui-policy.md` — annotata l'eccezione di marchio.

### Logo, icone e nome

- `apps/ui/app/components/icons/sinopiacad-wordmark.tsx` — marchio Sinopia + «SinopiaCAD» (nuovo).
- `apps/ui/public/brand/sinopia-mark.png` — logo rosso di Sinopia (nuovo).
- `apps/ui/public/favicon.ico`, `favicon-96x96.png`, `apple-touch-icon.png`,
  `android-chrome-192x192.png`, `android-chrome-512x512.png` — icone Sinopia.
- `apps/ui/public/favicon.svg` — rimosso (era il logo di Tau).
- `apps/ui/app/hooks/use-favicon.ts` — rimosso (ricolorava il logo di Tau).
- `apps/ui/app/root-layout.tsx`, `apps/ui/app/root.tsx`, `apps/ui/desktop/app/root.tsx`,
  `apps/ui/app/routes/manifest[.webmanifest].ts` — icone e colore tema avorio.
- `apps/ui/app/constants/meta.constants.ts` — nome «SinopiaCAD» e descrizione.
- `apps/ui/app/components/layout/app-sidebar.tsx`, `desktop-titlebar-controls.tsx`,
  `apps/ui/app/components/share/publication-topbar.tsx`, `apps/ui/app/routes/auth.$/route.tsx` —
  marchio SinopiaCAD al posto del wordmark Tau.
- Titoli di pagina «… · SinopiaCAD»: `apps/ui/app/routes/` `community`, `convert`, `files`,
  `github.complete`, `import.$`, `invitations.$token`, `machines._index`,
  `machines.$hostId.$machineId`, `parts`, `plugins`, `projects_`, `projects_.new`, `s.$slug`,
  `workflows`, `auth.cli`.
- Nome dell'agente integrato e testi visibili: `apps/ui/app/components/chat/chat-agent-sheet.tsx`,
  `chat-execution-selector.tsx`, `chat-approval-banner.tsx`, `tiptap/use-chat-editor.ts`,
  `apps/ui/app/components/project-library/project-library.tsx`,
  `apps/ui/app/components/settings/settings-registry.ts`, `apps/ui/app/hooks/use-cad-agent-config.ts`,
  `apps/ui/app/routes/w.$workspace.$project/` `chat-error.tsx`, `packages-panel.tsx`,
  `project-route.tsx`, `project-route-notices.tsx`, `project-unavailable-overlay.tsx`.

### Pagine legali e «Informazioni»

- `apps/ui/app/lib/legal-url.ts` — privacy, condizioni e cookie puntano a sinopialab.com.
- `apps/ui/app/components/cookie-preferences.tsx`, `apps/ui/app/components/billing/topup-modal.tsx` —
  testi con il nome SinopiaCAD.
- `apps/ui/app/components/nav/about-sinopiacad.tsx` — finestra «Informazioni» con crediti a Tau e
  licenza Apache-2.0 (nuovo).
- `apps/ui/app/components/nav/nav-user.tsx` — voce «Informazioni» e versione «SinopiaCAD» nel menu Aiuto.

### Test aggiornati

- `apps/ui/app/components/nav/about-sinopiacad.test.tsx` (nuovo), `nav-user.test.tsx`,
  `apps/ui/app/lib/legal-url.test.ts`, `apps/ui/app/components/settings/general-settings.test.tsx`,
  `apps/ui/app/components/billing/topup-modal.test.tsx`,
  `apps/ui/app/components/chat/chat-agent-sheet.test.tsx`, `chat-execution-selector.test.tsx`,
  `chat-approval-banner.test.tsx`, `apps/ui/app/components/layout/desktop-titlebar-controls.test.tsx`,
  `apps/ui/app/components/project-library/project-library.test.tsx`,
  `apps/ui/app/hooks/use-cad-agent-config.test.tsx`, `apps/ui/app/routes/community/route.test.tsx`,
  `apps/ui/app/routes/s.$slug/route.test.ts`, `apps/ui/app/routes/w.$workspace.$project/`
  `chat-error.test.tsx`, `packages-panel.test.tsx`.

## 23 ottobre 2026 — progetto: Misure a sinistra, modello al centro, agente a destra

La pagina del progetto si apre sul modello 3D, con le Misure (i parametri) a sinistra e l'agente a destra; nessun
codice in vista. Il codice resta raggiungibile dalla palette dei comandi (⌘K), per chi sviluppa.

### Disposizione e interruttori

- `apps/ui/app/routes/w.$workspace.$project/chat-interface-desktop.tsx` — corsie nell'ordine Misure, modello, agente;
  ⌃W mostra o nasconde le Misure; soglia compatta a 1024 px, così a 1280 px restano tutte e tre.
- `apps/ui/app/routes/w.$workspace.$project/workspace-skeleton.tsx` — lo scheletro di caricamento segue lo stesso ordine.
- `apps/ui/app/routes/w.$workspace.$project/workbench-toggle.tsx` — interruttore «Misure» in testa alla corsia, o alla
  barra del modello quando è chiusa (sostituisce l'interruttore flottante del banco di lavoro).
- `apps/ui/app/routes/w.$workspace.$project/chat-lane-toggle.tsx`, `chat-title-bar.tsx`,
  `project-workspace-actions.tsx` — interruttore «Agente» nell'angolo in alto a destra: in fondo all'intestazione
  dell'agente quando è aperto, in fondo alla barra del modello quando è chiuso.
- `apps/ui/app/routes/w.$workspace.$project/lane-toggle-focus.ts` — passaggio del fuoco tra i due posti di un
  interruttore (nuovo).
- `apps/ui/app/routes/w.$workspace.$project/chat-viewer-dockview.tsx` — la barra del modello ospita l'interruttore
  Misure.
- `apps/ui/app/constants/editor.constants.ts`, `apps/ui/app/types/editor.types.ts`,
  `apps/ui/app/utils/panel-state.utils.ts`, `apps/ui/app/machines/editor.machine.ts` — Misure larga 280 px (minimo
  240); le larghezze salvate prima di questa disposizione tornano ai valori nuovi una volta (`layoutRevision`).
- `apps/ui/app/workbench-records/pane-titles.ts` — il pannello Parameters si chiama «Misure».

### Niente codice in vista

- `apps/ui/app/hooks/use-project.tsx` — aprendo un progetto non si riaprono le schede di file della visita precedente.
- `apps/ui/app/routes/w.$workspace.$project/workbench-lane-presentation.ts` — una scheda di file salvata nella
  disposizione (o aggiunta dall'agente) compare solo se il file è stato aperto in questa finestra; corsia vuota = Misure
  (nuovo).
- `apps/ui/app/routes/w.$workspace.$project/chat-workbench-dockview.tsx` — corsia nuova o vuota apre le Misure, non il
  lanciatore; il «+» non offre più i file; la disposizione salvata passa dal filtro qui sopra.
- `apps/ui/app/workbench-records/initial-files.ts`, `apps/ui/app/routes/projects_.new/route.tsx` — un progetto nuovo
  parte da modello, Misure e agente, non dal codice.
- `apps/ui/app/routes/w.$workspace.$project/chat-parameters.tsx` — tolta la voce «Open in editor» dalle Misure.
- `apps/ui/app/routes/w.$workspace.$project/project-command-items.tsx` — ⌘K: «Apri il codice del modello» e
  «Apri le misure».

### Menu Aiuto e agenti

- `apps/ui/app/components/nav/nav-user.tsx` — tolti Documentation, Report a bug, GitHub e Discord di Tau; «Sito di
  Sinopia» apre sinopialab.com in una nuova scheda senza toccare la scelta della pagina iniziale.
- `apps/ui/app/lib/sinopia-agents.ts` (nuovo), `apps/ui/app/hooks/use-cad-agent-config.ts` — Codex e Grok Build non
  compaiono fra gli agenti; restano l'agente SinopiaCAD e Claude Code.

### Test

- Nuovi: `apps/ui/app/lib/sinopia-agents.test.ts`, `apps/ui/app/utils/panel-state.utils.test.ts`,
  `apps/ui/app/routes/w.$workspace.$project/workbench-lane-presentation.test.ts`.
- Aggiornati: `apps/ui/app/components/nav/nav-user.test.tsx`, `apps/ui/app/constants/editor.constants.test.ts`,
  `apps/ui/app/hooks/use-cad-agent-config.test.tsx`, `apps/ui/app/workbench-records/converters.test.ts`,
  `initial-files.test.ts`, `apps/ui/app/routes/w.$workspace.$project/` `chat-interface-desktop.test.tsx`,
  `chat-lane-toggle.test.tsx`, `chat-parameters.test.tsx`, `chat-title-bar.test.tsx`,
  `chat-workbench-dockview.test.tsx`, `project-workspace-actions.test.tsx`, `project-workspace-context.test.tsx`,
  `workbench-toggle.test.tsx` (riscritto per il nuovo interruttore).
- `apps/ui-e2e/src/*.spec.ts` (15 file) — solo i nomi accessibili: «Toggle Chat lane» → «Agente», «Toggle Workbench
  lane» → «Misure».
