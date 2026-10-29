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

## 23 ottobre 2026 — accesso con l'account Sinopia e funzione «sinopiacad»

SinopiaCAD entra con l'account Sinopia (Supabase Auth del progetto di Sinopia) e parla solo con la funzione
`sinopiacad` di Sinopia, che fa da catalogo modelli, proxy LLM e dettatura. Online, a `sinopialab.com/cad`, la
sessione di Sinopia è già quella giusta: SinopiaCAD legge la stessa chiave di localStorage
(`sb-<progetto>-auth-token`). Il login di Tau (Better Auth) resta nel codice ma è spento.

### Sessione e accesso

- `pnpm-workspace.yaml`, `apps/ui/package.json`, `pnpm-lock.yaml` — dipendenza `@supabase/supabase-js` 2.117.3
  (versione esatta nel catalogo).
- `apps/ui/app/lib/sinopia-session.ts` (nuovo) — la sessione Sinopia: stessa chiave di sinopialab.com, token sempre
  aggiornato (lo rinnova da sé un minuto prima della scadenza, anche a scheda nascosta), accesso con email e password,
  «Esci» solo su questo browser; supabase-js si carica solo nel browser, al primo uso.
- `apps/ui/app/hooks/use-sinopia-session.ts` (nuovo) — lo stato della sessione per React.
- `apps/ui/app/components/auth/sinopia/sinopia-login.tsx` (nuovo) — schermata «Accedi con il tuo account Sinopia»
  (email e password, errori in italiano, niente registrazione né accesso social).
- `apps/ui/app/components/auth/sinopia/sinopia-session-gate.tsx` (nuovo), `apps/ui/app/root-layout.tsx` — senza
  sessione Sinopia il lavoro non parte: si vede la schermata di accesso.
- `apps/ui/app/components/auth/sinopia/sinopia-user-menu.tsx` (nuovo), `apps/ui/app/components/auth/user/user-button.tsx`
  — il menu dell'account mostra l'account Sinopia e la voce «Esci».
- `apps/ui/app/lib/auth-client.ts` — con Sinopia configurato, Better Auth non manda più richieste (resta inerte).
- `apps/ui/app/environment.config.ts` — nuove variabili pubbliche `SINOPIA_SUPABASE_URL` e
  `SINOPIA_SUPABASE_PUBLISHABLE_KEY`.
- `scripts/sinopiacad-dev.sh` (nuovo nel repository) — avvio locale con `TAU_API_URL` = funzione `sinopiacad` e il
  progetto Supabase di Sinopia.

### Token verso la funzione

- `apps/ui/app/hooks/use-models.tsx` — il catalogo modelli porta `Authorization: Bearer <token>`; una chat nuova parte
  sempre con l'agente SinopiaCAD (mai con un agente esterno usato prima) e sul modello consigliato dal catalogo.
- `apps/ui/app/components/dictation/dictation-client.ts` — stato e trascrizione della dettatura con il token.
- `apps/ui/app/workers/agent-host.contract.ts`, `agent-host.worker.ts`, `agent-host.impl.ts`,
  `apps/ui/app/services/agent-host-client.ts` — il worker dell'agente riceve il token con `provide` e a ogni rinnovo
  (nuova chiamata `accessToken`); il gateway dei modelli legge il token corrente a ogni richiesta.
- `apps/ui/app/runtime/observability/report-to-api.ts` — la telemetria non invia più nulla (la funzione non la riceve).

### Test

- Nuovi: `apps/ui/app/lib/sinopia-session.test.ts`, `apps/ui/app/components/auth/sinopia/sinopia-login.test.tsx`,
  `sinopia-session-gate.test.tsx`, `apps/ui/app/workers/agent-host.worker.test.ts`,
  `apps/ui/app/runtime/observability/report-to-api.test.ts`.
- Aggiornati: `apps/ui/app/hooks/use-models.test.tsx`, `apps/ui/app/components/dictation/dictation-client.test.ts`,
  `apps/ui/app/services/agent-host-client.test.ts`, `apps/ui/app/workers/agent-host.impl.test.ts`,
  `apps/ui/app/components/auth/user/user-button.test.tsx`, `apps/ui/app/lib/auth-client.test.ts`,
  `apps/ui/app/environment.config.test.ts`.

## 23 ottobre 2026 — l'agente sceglie il motore, parla da SinopiaCAD e sa passare dall'immagine al CAD

Nessuno sceglie più il motore geometrico a mano: l'agente lo sceglie per ogni lavoro fra i quattro che SinopiaCAD usa
(SMLib, predefinito, per i pezzi di precisione; PicoVoxel per le forme scolpite; Replicad come ripiego esatto di
OpenCascade; Manifold per il lavoro sulle mesh). Un progetto già scritto per un motore lo tiene. L'agente integrato si
presenta come agente di SinopiaCAD, risponde in italiano semplice e ha una skill per costruire un gioiello da immagini.

### Motori offerti

- `apps/ui/app/lib/sinopia-engines.ts` (nuovo) — i quattro motori, SMLib per primo e come file di partenza.
- `apps/ui/app/constants/available-kernel-configurations.ts` — offre solo quei quattro; `isKernelExecutable` dice se
  il runtime esegue comunque un motore non offerto, così un progetto scritto per un altro motore si apre ancora.
- `apps/ui/app/routes/w.$workspace.$project/project-route.tsx` — l'apertura di un progetto usa `isKernelExecutable`.
- `apps/ui/app/lib/system-skills-catalog.ts` — tolte le skill `cad-*` dei motori non offerti; registrata la skill
  `sinopia-immagine-cad`.
- `apps/ui/app/lib/create-model-skill.ts` — `create-model` riscritta per gioielli e accessori: tabella dei quattro
  motori, regole per lavoro («SMLib salvo forme scolpite»), pezzi misti in parti separate con l'avviso che unirli in un
  solo STEP esatto non è ancora provato.

### Niente scelta del motore per la persona

- `apps/ui/app/components/chat/chat-kernel-selector.tsx`, `kernel-selector.tsx` — rimossi (e il test del primo).
- `apps/ui/app/components/chat/chat-textarea-desktop.tsx`, `chat-textarea.tsx`, `chat-textarea-types.ts` — tolto il
  selettore del motore dalla barra della chat (`enableKernelSelector`).
- `apps/ui/app/components/chat/new-project-chat-composer.tsx`, `apps/ui/app/routes/projects_.new/route.tsx` — un
  progetto nuovo parte dal file vuoto di SMLib senza fissare il motore; via la scheda «Choose CAD Kernel».
- `apps/ui/app/hooks/use-project-manager.tsx` — la chat di un progetto nuovo fissa un motore solo se chi crea lo chiede.
- `apps/ui/app/hooks/active-chat-provider.tsx`, `use-cad-agent-config.ts`,
  `apps/ui/app/routes/w.$workspace.$project/project-live-sessions.tsx` — il motore della chat è quello salvato nella
  chat se SinopiaCAD lo offre, altrimenti nessuno (niente più ripiego sul cookie).
- `apps/ui/app/chat-clients/_internal/agent-usage-telemetry.ts`,
  `apps/ui/app/routes/w.$workspace.$project/chat-stack-trace.tsx` — accettano una chat senza motore.

### Agente: motore libero e persona

- `libs/chat/src/schemas/agent-config.schema.ts` — `kernel` facoltativo: assente, l'agente sceglie.
- `libs/chat/src/prompts/cad-agent.prompt.ts` — senza motore fissato il prompt indica `create-model` (o di tenere il
  motore di un modello già costruito); identità e pubblico di SinopiaCAD (designer di gioielli e accessori,
  modellisti), italiano semplice e corto, niente codice, nomi di file, motori o strumenti nelle risposte, misure in
  testo semplice; resta il rigore da produzione. Annotate le voci `EVAL(sinopia-persona)` e `EVAL(unpinned-engine)`.
- `apps/ui/app/lib/sinopia-immagine-cad-skill.ts` (nuovo) — skill `sinopia-immagine-cad`: scomposizione in pezzi,
  scala dalle misure standard, viste nascoste, pezzi con nomi italiani, al massimo 3 giri di controllo con le viste,
  misure raggruppate per pezzo in `defaultParams`, colori, densità 15,5 per l'oro 18 kt, trappole di SMLib.

### Test

- Nuovi: `apps/ui/app/lib/sinopia-engines.test.ts`.
- Aggiornati: `libs/chat/src/prompts/cad-agent.prompt.test.ts`, `libs/chat/src/schemas/agent-config.schema.test.ts`,
  `apps/ui/app/lib/system-skills-catalog.test.ts`, `system-skills-budget.test.ts`,
  `apps/ui/app/hooks/active-chat-provider.test.tsx`, `use-cad-agent-config.test.tsx`, `use-project-manager.test.ts`,
  `apps/ui/app/components/chat/chat-textarea-desktop.test.tsx`, `chat-textarea.browser.test.tsx`,
  `new-project-chat-composer.test.tsx`, `apps/ui/app/routes/projects_.new/route.test.tsx`.
- `apps/ui-e2e/src/chat-edit-controls.spec.ts`, `workbench-pane-files.spec.ts` — tolti i passi sul selettore del motore.
- `apps/ui/specs/message-queue/MessageQueue.tla`, `MessageQueue/drift.json` — annotato che togliere il selettore
  del motore cambia solo i comandi della chat; aggiornate le impronte di `chat-textarea.tsx` e della specifica.

## 23 ottobre 2026 — «Continua con Google» e stessi criteri d'ingresso di sinopialab.com

Sulla schermata di accesso c'è anche Google, come su sinopialab.com (PKCE, scelta dell'account ogni volta). Dopo
qualunque accesso (Google o password) SinopiaCAD lascia entrare solo un account che sinopialab.com farebbe entrare
nella sua app: un account nuovo creato da Google, in lista d'attesa o senza Termini accettati viene disconnesso su
questo browser e la schermata dice dove completarlo (link a `https://sinopialab.com/auth`).

### Criteri (gli stessi controlli di Sinopia, nello stesso ordine)

1. Secondo fattore (`MfaChallengeGate`): un account con un'app di autenticazione conferma il codice prima di tutto.
2. Profilo (`authStore.fetchUserProfile`): `profiles.role` è un ruolo d'account (`normalizePersistedRole`).
3. Porta beta (`BetaGate`, RPC `get_my_beta_status`, solo designer): `needs_profile` e `waitlisted` restano fuori.
4. Professione (`ProtectedRoute`, RPC `needs_profession_selection`): da scegliere fuori dalla beta → fuori.
5. Termini (`TermsGate`, `user_consents` chiave `terms`): versione accettata almeno `2026-08-17`.

Una lettura fallita non chiude fuori nessuno e non lo disconnette: compare «Riprova» (come `sessionError` e
`BetaGateRetry` di Sinopia); se manca solo lo stato beta e i Termini sono in archivio, si entra (come `BetaGate`).

### File

- `apps/ui/app/lib/sinopia-access.ts` (nuovo) — i criteri d'ingresso e i messaggi in italiano.
- `apps/ui/app/lib/sinopia-oauth-return.ts` (nuovo) — ricorda l'indirizzo prima di Google (10 minuti, questa scheda) e
  al ritorno lo ripristina senza `?code=`.
- `apps/ui/app/lib/sinopia-session.ts` — client con `flowType: 'pkce'` e `detectSessionInUrl: true`; accesso con
  Google; controllo d'ingresso dopo ogni accesso; nessun token alla funzione prima dell'ingresso; secondo fattore;
  «Riprova».
- `apps/ui/app/hooks/use-sinopia-session.ts` — `useSinopiaReturn`.
- `apps/ui/app/components/auth/sinopia/sinopia-google-button.tsx` (nuovo) — «Continua con Google» con la G ufficiale
  a quattro colori, stato «Reindirizzamento a Google…», sblocco al ritorno col tasto indietro (`pageshow`).
- `apps/ui/app/components/auth/sinopia/sinopia-login.tsx` — Google sopra, «oppure con email e password», avvisi.
- `apps/ui/app/components/auth/sinopia/sinopia-auth-frame.tsx`, `sinopia-second-factor.tsx`, `sinopia-access-retry.tsx`
  (nuovi) — cornice comune, codice del secondo fattore, «Riprova».
- `apps/ui/app/components/auth/sinopia/sinopia-session-gate.tsx` — nuovi stati e ritorno all'indirizzo di partenza
  prima che il lavoro si apra.

### Test

- Nuovi: `apps/ui/app/lib/sinopia-access.test.ts`, `sinopia-oauth-return.test.ts`,
  `apps/ui/app/lib/testing/sinopia-backend.ts` (progetto Supabase finto), `sinopia-google-button.test.tsx`,
  `sinopia-second-factor.test.tsx`.
- Aggiornati: `apps/ui/app/lib/sinopia-session.test.ts`, `sinopia-login.test.tsx`, `sinopia-session-gate.test.tsx`.

### Da fare in Supabase Auth (URL di reindirizzamento ammessi)

`http://127.0.0.1:4310/**`, `https://sinopiacad.vercel.app/**`, `https://cad.sinopialab.com/**`.

## 23 ottobre 2026 — la home di SinopiaCAD: dall'immagine al CAD, con l'agente accanto

La home non è più quella di Tau. Al centro c'è una sola azione, «Dall'immagine al CAD»: si trascina, si incolla (⌘V) o
si sceglie la foto o il disegno del pezzo, anche un'immagine salvata dal Creator di Sinopia. Sotto, «I tuoi progetti» con
le miniature dei modelli. A destra c'è l'agente come nella pagina del progetto: stessa corsia, stesso interruttore
«Agente» (⌃C), stato ricordato. Le immagini lasciate nella pagina diventano allegati del messaggio per l'agente (un solo
posto per scrivere, dettare e mandare); il primo messaggio crea il progetto e lo apre con quella stessa conversazione
(il flusso del primo turno di Tau, `Chat.startupRequest`). Tolti dalla home: «Build from code», la scelta del posto
(«Home»/cartella: il progetto nasce in Home), il titolo inglese e la vetrina «Built with Tau». La parte visiva resta
semplice: la rifinisce il passaggio di design.

### Home

- `apps/ui/app/routes/_index/sinopia-home.tsx` (nuovo) — la home: area principale accanto alla corsia dell'agente;
  trascinamento ovunque nella pagina, incolla quando non si scrive in un campo, ⌃C, annuncio per i lettori di schermo;
  al telefono il messaggio sta sotto la zona immagini, senza corsia.
- `apps/ui/app/routes/_index/home-image-drop-zone.tsx` (nuovo) — titolo, zona di rilascio, «Scegli un'immagine», limiti
  e miniature delle immagini già allegate (testo alternativo = nome del file).
- `apps/ui/app/routes/_index/use-home-image-intake.ts` (nuovo) — le immagini entrano nella bozza del compositore
  (`addDraftAttachment`, che le riduce e le salva come per il compositore stesso): solo JPG, PNG, WebP o GIF fino a
  20 MB, solo se il modello dell'agente legge immagini; ogni rifiuto spiega il perché in italiano.
- `apps/ui/app/routes/_index/home-agent-lane.tsx` (nuovo) — la corsia dell'agente della home: intestazione con
  l'interruttore, «Cosa costruiamo?», il compositore del nuovo progetto.
- `apps/ui/app/routes/_index/home-recent-projects.tsx` (nuovo) — «I tuoi progetti»: gli ultimi dieci, sulla griglia e
  la scheda della libreria, con «Tutti i progetti».
- `apps/ui/app/routes/_index/route.tsx`, `home-surface.desktop.tsx` — web e desktop mostrano la stessa home.
- `apps/ui/app/routes/_index/homepage-chat-hero.tsx` — rimosso (titolo inglese e «Build from code»).

### Agente e compositore condivisi con la pagina del progetto

- `apps/ui/app/routes/w.$workspace.$project/agent-lane-toggle-button.tsx` (nuovo), `chat-lane-toggle.tsx`,
  `chat-history.tsx` — l'interruttore «Agente» separato dal progetto, così la home usa lo stesso.
- `apps/ui/app/hooks/use-agent-lane-open.ts` (nuovo), `apps/ui/app/constants/cookie.constants.ts` (`chat-op-lane`),
  `apps/ui/app/routes/w.$workspace.$project/project-workspace-context.tsx` — l'ultima scelta (aperta o chiusa) fatta
  nella home o in un progetto vale per la home; ogni progetto tiene anche la sua.
- `apps/ui/app/components/chat/new-project-chat-composer.tsx` — `enableLocationPicker` (la home lo spegne e crea in
  Home), `ref` per dare il fuoco al compositore, errore in italiano.
- `apps/ui/app/components/chat/tiptap/use-chat-editor.ts` — invito del compositore in italiano: «Descrivi cosa costruire
  o cosa cambiare…».

### Community nascosta

La pagina e i suoi dati restano nel codice, per il ridisegno; nessuno la vede né la raggiunge.

- `apps/ui/app/constants/route.constants.ts` — tolta la voce «Community» dal menu «More».
- `apps/ui/app/routes/community/route.tsx` — `/community` porta alla home (`clientLoader`, anche nel desktop).
- `apps/ui/app/root-layout.tsx` — niente più scheletro «Opening examples» per `/community`.
- `apps/ui/app/root.tsx` — la palette dei comandi non elenca più «Browse examples» né gli esempi di Tau.
- `apps/ui/app/components/share/publication-topbar.tsx` — un esempio condiviso non rimanda più alla galleria.

### Test

- Nuovi: `apps/ui/app/routes/_index/sinopia-home.test.tsx`, `home-recent-projects.test.tsx`.
- Aggiornati: `apps/ui/app/routes/_index/route.test.tsx` (titolo «SinopiaCAD»), `home-surface.desktop.test.tsx`,
  `apps/ui/app/components/chat/new-project-chat-composer.test.tsx`,
  `apps/ui/app/routes/w.$workspace.$project/project-workspace-context.test.tsx`,
  `apps/ui/app/routes/community/route.test.tsx`, `apps/ui/app/root-layout.test.tsx`,
  `apps/ui/app/components/share/publication-topbar.test.tsx`, `apps/ui/app/components/layout/app-sidebar.test.tsx`,
  `apps/ui-e2e/src/home-hydration.spec.ts` (titoli della home).
- Rimosso: `apps/ui/app/routes/_index/new-project-chat-composer-surfaces.test.tsx` (provava il vecchio titolo).

## 23 ottobre 2026 — passo 1 del design: pagina progetto pulita, italiano e inglese, due temi

Primo passo di `UI-UX-SinopiaCAD.md` (§11, punto 1). Tutta l'app parla italiano e inglese; la lingua si sceglie così:
scelta salvata su questo dispositivo, poi la lingua del browser (`it*` italiano, ogni altra inglese), poi italiano. Si
cambia dal menu account (e dalla schermata di accesso), si applica subito in tutte le schede, e l'agente risponde nella
stessa lingua. I temi sono due, Chiaro e Nero (il carbone caldo di Sinopia), più «Sistema»; Scuro e Alto contrasto di
Tau restano nel codice ma non si scelgono. Con «più contrasto» del sistema operativo il tema non cambia: filettature da
1 a 2 px, contorno di fuoco da 2 a 3 px, filettature a 3:1. La pagina progetto ha una sola barra in alto: Misure,
«Progetti › nome» (il nome si rinomina lì), lo stato del salvataggio in parole, Versioni, Esporta, «Invia a Sinopia»
(presente ma in attesa del passo 6, con il perché nel suggerimento) e Agente. Via il ramo «main», Condividi, le schede
dei file sopra il modello e «main.ts» in testa alle Misure; la barra della vista dice Adatta, Sezione, Misura, Foto e la
griglia in mm, senza Schermo intero.

### Lingua (nuovo, dizionario tipizzato senza dipendenze)

- `apps/ui/app/i18n/language.ts` — lingua, ordine di scelta, memoria sul dispositivo, `lang` del documento, sincronia
  fra schede (`Topic` di `@taucad/events`), `useLanguage`.
- `apps/ui/app/i18n/translate.ts`, `define-messages.ts`, `catalog.ts` — `useTranslation()`/`t('area.chiave')` con
  segnaposto `{nome}` tipizzati, `translate()` fuori da React, numeri e ore nel formato della lingua.
- `apps/ui/app/i18n/messages/` `account.ts`, `auth.ts`, `common.ts`, `home.ts`, `project.ts`, `shell.ts`, `viewer.ts` —
  i testi IT/EN, un file per area; TypeScript rifiuta un inglese con chiavi mancanti o in più.
- `apps/ui/app/root-layout.tsx` — `<html lang>` segue la lingua.

### Menu account, temi

- `apps/ui/app/components/auth/sinopia/account-preferences.tsx` (nuovo), `sinopia-user-menu.tsx` — Tema «Chiaro · Nero ·
  Sistema» e Lingua «Italiano · English» nel menu account, applicati subito.
- `apps/ui/app/hooks/use-theme.tsx` — scelte Chiaro, Nero, Sistema (Scuro e Alto contrasto si leggono come Nero),
  nomi tradotti, ciclo a tre.
- `apps/ui/app/components/settings/general-settings.tsx` — il selettore del tema offre solo quelle tre.
- `packages/ui/src/styles/tokens.css` — `black` ridefinito come Nero di Sinopia (la scala di Dark, tinta carta);
  `--hairline-width` e `--default-border-width`; `prefers-contrast: more` senza terza palette.
- `apps/ui/app/styles/global.css` — via i diagrammi «nero puro»; la barra delle schede del modello nascosta.
- `docs/policy/color-policy.md` — annotata l'eccezione Nero e «più contrasto».

### Pagina progetto

- `apps/ui/app/routes/w.$workspace.$project/project-top-bar.tsx`, `project-save-status.tsx` (nuovi),
  `chat-interface-desktop.tsx` — la barra unica in alto e lo stato del salvataggio a frase; la vista senza schede.
- `project-workspace-actions.tsx`, `project-export-action.tsx`, `chat-viewer-dockview.tsx`, `workbench-toggle.tsx`,
  `agent-lane-toggle-button.tsx`, `chat-lane-toggle.tsx` — niente ramo, Condividi o interruttori nella barra della vista;
  gli interruttori Misure e Agente stanno nella barra in alto, il pulsante nella testata della corsia la chiude
  («Nascondi l'agente», «Nascondi le misure»).
- `chat-title-bar.tsx`, `chat-history-settings.tsx`, `chat-history.tsx`, `chat-history-empty.tsx`,
  `workspace-skeleton.tsx`, `project-not-found.tsx`, `chat-viewer-projection-picker.tsx`, `chat-parameters.tsx`,
  `chat-workbench-dockview.tsx` — testi IT/EN; il menu della conversazione non mostra più modello e crediti; le Misure
  chiamano la sezione principale «Modello» invece del nome del file.
- `apps/ui/app/workbench-records/pane-titles.ts`, `apps/ui/app/components/panes/dockview-tab.tsx`,
  `with-tab-context-menu.tsx` — le schede Misure, Versioni, Esporta nella lingua scelta.
- `apps/ui/app/components/chat/` `chat-textarea-desktop.tsx`, `chat-textarea-submit-button.tsx`, `chat-textarea.tsx`,
  `chat-textarea-types.ts`, `tiptap/use-chat-editor.ts`, `new-project-chat-composer.tsx` — casella «Scrivi o detta una
  modifica…» (home: «Scrivi o detta…»), +, Invia, Ferma in IT/EN.
- `apps/ui/app/components/geometry/app-viewer-environment.tsx`, `cad/capture-view-control.tsx` — parole della barra della
  vista e «Foto».
- `packages/viewer/src/environment/viewer-environment.tsx` e `src/cad/` `fit-view-control.tsx`, `section-view-control.tsx`,
  `measure-control.tsx`, `grid-control.tsx`, `viewer-settings.tsx`, `viewer-controls.tsx` — `labels` e
  `showFullscreenControl` per chi incorpora la vista; «Adatta» con etichetta.
- `packages/workbench-panes/src/parameters/parameters-source.ts`, `parameters-pane.tsx` — `entryTitle` e `filterLabels`.

### Agente nella lingua dell'interfaccia

- `libs/chat/src/schemas/agent-config.schema.ts` — `language: it|en` facoltativo (assente = italiano).
- `libs/chat/src/prompts/cad-agent.prompt.ts` — il tono non nomina più l'italiano; sezione dinamica `reply_language`
  (Block 1 resta in cache). Annotata `EVAL(reply-language)`.
- `apps/ui/app/hooks/use-cad-agent-config.ts`, `apps/ui/app/chat-clients/_internal/turn-body.ts` — la lingua arriva
  nel prompt.

### Shell, accesso, home (testi IT/EN)

- `apps/ui/app/components/layout/app-sidebar.tsx`, `command-palette.tsx`, `apps/ui/app/root-command-items.tsx`,
  `apps/ui/app/constants/route.constants.ts`, `apps/ui/app/components/nav/` `nav-chat.tsx`, `nav-main.tsx`,
  `nav-user.tsx`, `project-navigation.tsx`, `project-chat-list.tsx`, `project-close-dialogs.tsx`,
  `about-sinopiacad.tsx`, `desktop-update.tsx`, `apps/ui/app/components/cookie-preferences.tsx`.
- `apps/ui/app/components/auth/sinopia/` `sinopia-login.tsx` (con «Italiano · English» in basso),
  `sinopia-google-button.tsx`, `sinopia-second-factor.tsx`, `sinopia-access-retry.tsx`, `sinopia-auth-frame.tsx`,
  `apps/ui/app/lib/sinopia-access.ts`, `sinopia-session.ts` (i messaggi diventano codici tradotti a video).
- `apps/ui/app/routes/_index/` `sinopia-home.tsx`, `home-image-drop-zone.tsx`, `use-home-image-intake.ts`,
  `home-agent-lane.tsx`, `home-recent-projects.tsx`.

### Test

- Nuovi: `apps/ui/app/i18n/language.test.ts`, `translate.test.ts`, `apps/ui/app/components/auth/sinopia/`
  `account-preferences.test.tsx`, `sinopia-access-retry.test.tsx`,
  `apps/ui/app/components/layout/command-palette.language.test.tsx`,
  `apps/ui/app/chat-clients/_internal/turn-body.test.ts`, `apps/ui/app/workbench-records/pane-titles.test.ts`,
  `apps/ui/app/routes/w.$workspace.$project/project-top-bar.test.tsx`, `project-save-status.test.ts`.
- Aggiornati (testi nelle due lingue, temi, barra): i test accanto a ogni file qui sopra, `apps/ui/app/styles/global.test.ts`,
  `apps/ui/app/hooks/use-theme.test.tsx`, `libs/chat` (prompt e schema), `packages/viewer/src/cad/fit-view-control.test.tsx`,
  `packages/workbench-panes/src/parameters/parameters-pane.test.tsx`,
  `apps/api/app/api/chat/chat.controller.json-schema.test.ts` (istantanea dello schema: `language`, `kernel` facoltativo).
- `apps/ui-e2e/src/*.spec.ts` (16 file) — nomi accessibili in inglese, la lingua del browser dei test: «Agente» →
  "Agent", «Misure» → "Measures", titoli della home.

## 23 ottobre 2026 — Misure per pezzo e selezione collegata

- `apps/ui/app/routes/w.$workspace.$project/{chat-parameters,piece-measures-pane,chat-viewer}.tsx`: lista dei pezzi con ricerca, selezione condivisa, apertura e scorrimento del gruppo, visibilità e riepilogo; conservata l'autorità dei parametri e il controllo numerico di Tau.
- `apps/ui/app/lib/piece-measures.ts`, `hooks/use-selected-piece.ts`, `components/chat/{selected-piece-chip,chat-textarea,chat-context-insertion}.tsx`: nomi leggibili IT/EN, chip in vista e sopra il messaggio, riferimento CAD strutturato; il riferimento attende il montaggio del composer quando l'agente è chiuso.
- `apps/ui/app/i18n/{catalog.ts,messages/measures.ts}`: testi bilingui. `packages/viewer/src/parameters/{parameters,parameters-widget,parameters-number,rjsf-theme}.tsx` e `rjsf-context.ts`: presentazione opzionale dei campi, provenienza e formato numerico nella lingua scelta.
- `packages/plugins/smlib/src/{parameter-assumptions,smlib.kernel,smlib.types}.ts` e `utils/{render-output,smlib-to-gltf}.ts`: ipotesi e proprietà fisiche dal modello fino ai metadati del visore. Massa in grammi = volume esatto in mm³ × densità in g/cm³ / 1000; totale «oro 18 kt» solo se tutti i pezzi metallici hanno massa valida e densità dichiarata 15,5. Altrimenti si mostrano i conteggi.
- `apps/ui/app/lib/sinopia-immagine-cad-skill.ts`: convenzione SMLib `export const ipotesi = { 'stelo.spessore': 'Motivo nella lingua del progetto' }`, oppure elenco di percorsi. Accettati anche puntatori JSON (`/stelo/spessore`). Il kernel trasporta queste annotazioni nelle descrizioni con `[sinopia:assumed]`; il marcatore tecnico non viene mostrato. Non sono parametri né metadati aggiunti al record `.tau/parameters/`.
- Il lucchetto deriva dalla presenza di un valore nel gruppo attivo del record, anche se uguale al valore iniziale; tale scelta prevale sull'avviso di ipotesi. Il record non contiene l'identità dell'autore: la skill prescrive di mantenere le scelte esplicite e di cambiare i valori iniziali per le ipotesi autonome.
- Test aggiunti in `piece-measures.test.ts`, `piece-measures-pane.test.tsx`, `selected-piece-chip.test.tsx`, `parameter-assumptions.test.ts`; estesi `parameters-number.test.tsx`, `smlib.kernel.test.ts` e `physical-materials.test.ts`.

Verifica locale: 146 test nei 7 file toccati (19 UI, 55 viewer, 72 SMLib), typecheck dei tre moduli, lint sui 28 file TypeScript senza errori (restano avvisi) e build di viewer/SMLib. Dopo l'interruzione per memoria, controlli eseguiti in sequenza, Vitest con `--maxWorkers=2`, lint/typecheck con `NODE_OPTIONS=--max-old-space-size=4096`.

La verifica dal vivo autenticata resta al coordinatore dopo l'unione dei rami; questa copia non avvia server e non pubblica modifiche.

## 2026-10-23 — Passo 7: Esporta con controlli per formato

- `apps/ui/app/routes/w.$workspace.$project/project-export-dialog*.tsx`: finestra con STEP, STL, GLB e foto,
  stati indipendenti, recupero degli errori, selezione di un pezzo o di tutti i pezzi. Per gli STL aperti,
  «Scarica comunque» e richiesta di chiusura aggiunta alla bozza dell'agente senza inviarla né cancellare la bozza precedente.
  Stati annunciati alle tecnologie assistive e pulsanti con bersagli di almeno 44 px sui dispositivi touch.
- `project-workspace-context.tsx`, `project-export-launcher.tsx`, `chat-workbench-dockview.tsx`,
  `chat-interface-mobile.tsx`: l'azione Esporta e le vecchie schede salvate convergono sulla finestra;
  nascosti provider e opzioni tecniche. Scorciatoia Cmd/Ctrl+E; il vecchio editor usa Ctrl+Shift+E per evitare conflitti.
- `apps/ui/app/hooks/use-project-export.ts`, `services/project-export.ts`: riuso di `awaitFreshRender`, delle
  claim del progetto, di `exportDocumentWithValidatedInput`, degli export del kernel e della cattura PNG esistente.
  Risultati invalidati quando cambia il modello o la selezione; nessun salvataggio di opzioni automatico.
  `prepareSinopiaFiles` prepara STEP, GLB e foto senza download, upload o persistenza, per il passo 6.
  «Invia a Sinopia» resta disabilitato.
- `services/project-export-step.ts`, `workers/project-export*`: lettura STEP tramite OpenCascade WASM in un
  worker separato, confronto dei nomi e del numero di solidi, `BRepCheck_Analyzer` su ogni pezzo.
  Il file di una selezione viene scritto e riletto prima di assegnare «Verificato».
  Un modello prodotto direttamente da OpenCascade non riceve il bollino indipendente dallo stesso motore.
- `services/project-export-mesh.ts`: controllo dei bordi degli STL effettivamente prodotti (due triangoli
  incidenti per bordo dopo saldatura delle coordinate), corrispondenza file/pezzo per nome; selezione GLB
  con trasformazioni e materiali conservati, senza metadati della vecchia geometria rimossa.
- `apps/ui/app/i18n/messages/export.ts`, `i18n/catalog.ts`: testi ed errori IT/EN, senza nomi di motori o file a video.
- Test accanto ai moduli: round trip reale Replicad → OpenCascade, STEP corrotto, nomi mancanti/duplicati,
  selezione STEP/STL/GLB e posizione GLB, stati e azioni IT/EN, cancellazione e timeout del worker.
- `apps/ui/project-export.vitest.browser.config.ts` e `workers/project-export.browser.test.ts`: tre prove
  del worker nel browser pronte per il coordinatore. Il sandbox locale vieta `listen` (`EPERM`), quindi
  queste prove e il collaudo visivo autenticato restano da eseguire dopo l'unione. Nessun server sulla porta 4310.
  Configurazione inclusa in `apps/ui/tsconfig.spec.json`; fixture locale
  `workers/fixtures/project-export-assembly.step`, copiata dalla fixture a due cubi di `apps/desktop-e2e`.
- Verifiche locali: `nx typecheck ui` superato su app e test (0 errori); lint mirato sui 21 file TS/TSX
  superato (0 errori, 4 avvisi preesistenti in `chat-workbench-dockview.tsx`). Vitest: 50 test su 4 file
  superati; dopo gli ultimi aggiustamenti, rieseguiti i 14 test dei 2 file interessati, tutti superati.
  `git diff --check` superato. Controlli eseguiti uno alla volta, Vitest con `--maxWorkers=2`,
  typecheck/lint con `NODE_OPTIONS=--max-old-space-size=4096`; nessun server di sviluppo avviato nella ripresa.

## 23 ottobre 2026 — Home secondo il design Fable (passo 4)

- `apps/ui/app/routes/_index/sinopia-home.tsx`, `home-image-drop-zone.tsx` — titolo e sottotitolo del design;
  riquadro con scelta immagini e ingresso «Da un progetto Sinopia»; stato pronto con miniature rimovibili,
  «Aggiungi vista», misura facoltativa, «Costruisci il CAD» e «Annulla». Il foglio Sinopia spiega il futuro
  collegamento, senza dati finti. La striscia «Da Sinopia» resta nascosta, con punto d'aggancio nel layout.
- `apps/ui/app/components/chat/use-new-project-submit.ts` (nuovo), `new-project-chat-composer.tsx` — stesso
  trasferimento degli allegati della bozza, esecuzione scelta e primo turno nel progetto; invio condiviso dalla
  home, protezione dai doppi clic e bozza conservata se la creazione fallisce. La misura entra nel primo messaggio.
- `apps/ui/app/components/chat/chat-textarea-types.ts`, `chat-textarea.tsx`, `chat-textarea-desktop.tsx` — la hero
  inoltra l'invio al composer montato, attendendo anche la dettatura. Durante la creazione la bozza è inerte,
  compresa l'aggiunta di allegati, anche riaprendo il pannello. Sulla home i controlli modello/agente/modalità
  vengono smontati insieme alle relative scorciatoie; gli errori non mostrano il nome del modello.
- `apps/ui/app/routes/_index/home-agent-lane.tsx`, `apps/ui/app/i18n/messages/home.ts` — intestazione «Agente»,
  «Dimmi cosa vuoi fare», descrizione e tre suggerimenti del design che compilano la bozza senza inviarla;
  tutti i nuovi testi in IT/EN. I formati dichiarati restano quelli realmente supportati (JPG, PNG, WebP, GIF,
  massimo 20 MB): HEIC richiede una conversione futura.
- `apps/ui/app/routes/_index/home-recent-projects.tsx` — anteprime 16:10, griglia a 2/3/4 colonne, ordinamento
  Ultimi modificati/Nome nel parametro URL `sort`, collegamento alla raccolta completa. Il numero dei pezzi
  compare solo quando fornito da metadati reali (`pieceCounts`); la lista attuale non lo conosce e non conta file.
- `apps/ui/app/components/layout/app-sidebar.tsx`, `apps/ui/app/components/nav/home-recent-navigation.tsx` (nuovo)
  — sulla home: Cerca, Inizio, Progetti, al massimo otto progetti recenti e account in basso; niente Nuovo progetto
  né Altro. Le altre pagine mantengono la navigazione esistente.
- Test aggiornati senza cancellazioni: `routes/_index/sinopia-home.test.tsx`, `home-recent-projects.test.tsx`,
  `components/chat/new-project-chat-composer.test.tsx`, `chat-textarea-desktop.test.tsx`,
  `components/layout/app-sidebar.test.tsx`; aggiunto `components/nav/home-recent-navigation.test.tsx`.
  `apps/ui-e2e/src/home-hydration.spec.ts` imposta la preferenza del modello nella fixture e verifica l'assenza
  del selettore nella UI della home, conservando il controllo del trasferimento immagine + PDF.

Verifica dal vivo ed esecuzione e2e della home riservate al coordinatore dopo l'unione, come da incarico.
Nessun server sulla porta 4310, pubblicazione, push o intervento su Supabase.

Controlli finali (dopo la ripresa, eseguiti uno alla volta):

- Vitest sui sei file di test toccati: **96/96 passati**, `--maxWorkers=2`.
- Nx typecheck `ui` e `ui-e2e`, `--parallel=1`: **0 errori**, tre configurazioni TypeScript.
- Nx lint mirato: **19 file**, oxlint + ESLint; **0 errori, 5 warning** (complessità e override delle dimensioni
  di pulsanti nel composer). Il file e2e passa senza warning di codice.
- Typecheck e lint con `NODE_OPTIONS=--max-old-space-size=4096`; cache e dati Nx confinati al worktree tramite
  `NX_WORKSPACE_DATA_DIRECTORY` e `NX_CACHE_DIRECTORY`. Nessun server di sviluppo.
- Revisione indipendente completata: corretti invio durante la dettatura e modifica della bozza durante creazione.

## 2026-10-23 — Versioni leggibili (passo 5)

- `apps/ui/app/routes/w.$workspace.$project/chat-revisions.tsx` e test: la scheda sinistra riusa il grafo di
  `useRevisions`, mantiene i numeri delle revisioni, divide l'elenco per giorno, mostra Tu/Agente e l'ora.
  Rami, backup, GitHub, salvataggio manuale, dettagli tecnici e collaboratori escono da questo pannello.
  Le azioni sono raggiungibili anche da tastiera e su schermi touch. Previsto il tipo di evento di invio
  (`VersionEvent`); nessun evento di invio viene inventato. Il pulsante Versioni della barra era già collegato
  a `openPanel('revisions')`, verificato dal test esistente della barra.
- `apps/ui/app/hooks/use-revisions.ts` e test: la provenienza strutturata distingue anche il salvataggio delle
  modifiche dell’utente prima di un turno dalla revisione del turno dell’agente; nessuna attribuzione dai nomi dei modelli.
- `revision-history.ts` e test: frasi dai valori e dalle unità dei record `.tau/parameters/`, ammissione con il
  parser canonico, date locali (anche al cambio dell'ora), riassunti registrati e ripristini nominati dal grafo.
  In assenza di informazioni affidabili si legge «Modifiche al modello»; percorsi e nomi tecnici non sono mostrati.
- `revision-preview.tsx` e test: Guarda apre un modello isolato con `CadPreviewProvider`, su una copia in memoria
  dell'albero storico, compresi gli allegati binari, e mostra le misure senza controlli di modifica. La banda
  «Stai guardando la Rev N» offre «Torna all'ultima». Chiudere non ripristina né salva il progetto corrente.
- `apps/ui/app/hooks/use-revision-status.ts`, `apps/ui/app/machines/file-manager.worker.revisions.ts` e test,
  `packages/host/src/revisions.ts` e test: lettura `snapshot` sul canale esistente, sia browser sia host nativo,
  senza comandi di scrittura, applicazione o cambio di ramo. Anteprime limitate a 64 MiB; un errore offre come
  rimediare senza esporre diagnostica o nomi di file.
- `revision-restore.tsx` e test: conferma e risultato del ripristino tradotti. Si continua a usare la macchina
  esistente, che salva prima le modifiche in corso e crea una nuova revisione, lasciando lo storico raggiungibile.
- `apps/ui/app/i18n/messages/versions.ts`, `apps/ui/app/i18n/catalog.ts`: testi tipizzati IT/EN del pannello,
  dell'anteprima, delle conferme e delle righe evento future. Nessuna pubblicazione o collegamento a Supabase.

### Verifiche e limiti della consegna

- Test mirati UI: 120 passati in 7 file, inclusa l’apertura di Versioni nelle due lingue e l’attribuzione del
  salvataggio precedente a un turno. Test di integrazione dell’host: 25 passati, 32 saltati dal gating dei
  prerequisiti Git; sul Mac manca `git-lfs`. La prova dello snapshot sul canale host passa sul percorso disponibile.
- Typecheck Nx `ui` e `host`: superati, sia configurazione applicativa/libreria sia configurazione dei test.
- Lint mirato oxlint + ESLint: nessun errore; 12 avvisi di complessità, lunghezza dei file e JSDoc nei file coinvolti.
- Dopo l’interruzione per memoria, controlli pesanti eseguiti uno alla volta, test con `--maxWorkers=2` e limite
  Node di 4096 MiB. Nessun server di sviluppo avviato.
- Resta al coordinatore il collaudo visivo e interattivo dopo l’unione. Gli eventi reali di invio a Sinopia sono
  intenzionalmente demandati al passo 6; questo passo prepara il tipo e la presentazione.

## 23 ottobre 2026 — passo 3, agente modellista

Il pannello Agente mostra uno stato IT/EN ricavato dagli eventi reali e il pulsante Ferma.
Gli strumenti, il ragionamento tecnico e i consumi sono nascosti nel flusso ordinario;
si possono ispezionare da ⌘K con «Mostra i dettagli tecnici dell’agente».
Il composer mantiene Invio durante il turno, riusando la coda durevole esistente.
I suggerimenti inviano messaggi con il riferimento strutturato del pezzo selezionato.
Il microfono resta accanto a Invio: tocco, pressione mantenuta e ⌘⇧M.
Le nuove richieste seguono la riga raccomandata del catalogo anche quando la prima
richiesta arriva prima della risposta del catalogo; i comandi già ammessi e la ripresa
mantengono l’esecuzione congelata dal registro dell’host.

«Cosa ho cambiato · Rev N» legge revisioni confermate e confronta i record parametri
immutabili tramite il client revisioni esistente, senza creare un secondo registro.
I pezzi sono collegati solo con corrispondenza esplicita nel manifesto corrente;
il clic seleziona il pezzo nel modello sorgente esatto, anche con ID ripetuti.
Quando mancano differenze misurabili o il modello storico non è disponibile,
compare «Modifiche al modello»: non si inventano misure, unità o revisioni.
Il lucchetto «tuo valore» richiede la prova di una modifica manuale nella revisione
immediatamente precedente; la sola presenza di un override non prova chi l’ha scritto.

### File modificati o aggiunti

- `apps/ui/app/chat-clients/chat-turn-host.tsx`.
- `apps/ui/app/chat-clients/use-cad-chat-client.test.tsx`.
- `apps/ui/app/components/chat/chat-activity-status.tsx`.
- `apps/ui/app/components/chat/chat-message-queue-view.tsx`.
- `apps/ui/app/components/chat/chat-textarea-desktop.test.tsx`.
- `apps/ui/app/components/chat/chat-textarea-desktop.tsx`.
- `apps/ui/app/components/chat/chat-textarea-submit-button.test.tsx`.
- `apps/ui/app/components/chat/chat-textarea-submit-button.tsx`.
- `apps/ui/app/components/chat/chat-textarea.browser.test.tsx`.
- `apps/ui/app/components/dictation/dictation-controls.tsx`.
- `apps/ui/app/components/dictation/use-dictation.test.ts`.
- `apps/ui/app/components/dictation/use-dictation.ts`.
- `apps/ui/app/components/layout/command-palette.tsx`.
- `apps/ui/app/hooks/active-chat-provider.test.tsx`.
- `apps/ui/app/hooks/active-chat-provider.tsx`.
- `apps/ui/app/hooks/use-models.test.tsx`.
- `apps/ui/app/hooks/use-models.tsx`.
- `apps/ui/app/i18n/catalog.ts`.
- `apps/ui/app/routes/w.$workspace.$project/chat-history.test.tsx`.
- `apps/ui/app/routes/w.$workspace.$project/chat-history.tsx`.
- `apps/ui/app/routes/w.$workspace.$project/chat-message-planning-indicator.test.tsx`.
- `apps/ui/app/routes/w.$workspace.$project/chat-message-planning.tsx`.
- `apps/ui/app/routes/w.$workspace.$project/chat-message.test.tsx`.
- `apps/ui/app/routes/w.$workspace.$project/chat-message.tsx`.
- `apps/ui/app/components/chat/agent-suggestions.test.tsx`.
- `apps/ui/app/components/chat/agent-suggestions.tsx`.
- `apps/ui/app/components/chat/chat-activity-status.test.tsx`.
- `apps/ui/app/components/chat/turn-model-summary.test.tsx`.
- `apps/ui/app/components/chat/turn-summary-card.test.tsx`.
- `apps/ui/app/components/chat/turn-summary-card.tsx`.
- `apps/ui/app/components/dictation/dictation-controls.test.tsx`.
- `apps/ui/app/hooks/use-agent-technical-details.ts`.
- `apps/ui/app/i18n/messages/agent.ts`.
- `apps/ui/app/lib/turn-model-changes.test.ts`.
- `apps/ui/app/lib/turn-model-changes.ts`.
- `apps/ui/app/utils/designer-message-part.ts`.
- `apps/ui/app/utils/modelling-activity.test.ts`.
- `apps/ui/app/utils/modelling-activity.ts`.

### Verifiche locali del passo 3

- `nx typecheck ui`: entrambe le configurazioni (`tsconfig.app.json` e `tsconfig.spec.json`), zero errori.
- `nx lint ui --files=…`: 38 file, uscita 0, sei avvisi di complessità/stile. ESLint segnala inoltre
  `tsconfig.base.json` assente nella configurazione Nx del checkout; non è una verifica completa
  di quella parte della configurazione delle dipendenze.
- Vitest mirato: 251 test passati in 18 file, `--maxWorkers=2`.
- Test browser del composer aggiornati; browser/e2e dal vivo lasciati al coordinatore come da incarico.
- Nessun server, chiamata di generazione a pagamento, push o modifica a Supabase.

## 23 ottobre 2026 — accesso, account e impostazioni (incarico 09)

Il menu dell’account Sinopia mostra email, lingua, tema, sito Sinopia, impostazioni,
informazioni ed uscita; non monta più le aggiunte Files e crediti Tau. I temi visibili
sono Chiaro, Nero e «Segui il Mac», mantenendo il comportamento Sistema previsto dal design.
Le impostazioni mostrano Aspetto (tema, lingua, cursori) e Modello (mm fissi).
Le sezioni tecniche e il loro codice Tau restano conservati, ma non sono raggiungibili
dalla navigazione, dalla ricerca né dai collegamenti diretti del dialogo.

Accesso, secondo fattore e rifiuto sono in italiano e inglese; il rifiuto ha una card
con motivo e rimedio, la registrazione rimanda a Sinopia, gli stati di attesa sono
annunciati. Le pagine non trovate e gli errori dell’app offrono azioni di recupero:
indirizzi, messaggi delle eccezioni e stack non sono più mostrati al designer.

Limiti di integrazione conservati: la lingua è ricordata sul dispositivo, non scritta
sull’account Sinopia; la sessione espone l’email, non il nome del profilo. Questo incarico
non modifica il controllo dei ruoli esistente (quindi non introduce il caso «ruolo non
ammesso» del design), né esegue operazioni Supabase. Le preferenze Agente e quelle del
modello ancora prive di un proprietario operativo non sono esposte come controlli fittizi.
La verifica visiva autenticata dopo l’unione spetta al coordinatore, come da incarico comune.

File modificati o aggiunti (compresi i controlli mirati):

- `apps/ui/app/components/auth/sinopia/account-preferences.test.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-access-retry.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-google-button.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-login.test.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-login.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-second-factor.test.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-second-factor.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-session-gate.test.tsx`
- `apps/ui/app/components/auth/sinopia/sinopia-user-menu.tsx`
- `apps/ui/app/components/auth/user/user-button.test.tsx`
- `apps/ui/app/components/auth/user/user-button.tsx`
- `apps/ui/app/components/error-page.test.tsx`
- `apps/ui/app/components/error-page.tsx`
- `apps/ui/app/components/nav/about-sinopiacad.tsx`
- `apps/ui/app/components/page-not-found.tsx`
- `apps/ui/app/components/settings/general-settings.test.tsx`
- `apps/ui/app/components/settings/settings-dialog.test.tsx`
- `apps/ui/app/components/settings/settings-dialog.tsx`
- `apps/ui/app/components/settings/settings-item.tsx`
- `apps/ui/app/components/settings/settings-registry.test.ts`
- `apps/ui/app/components/settings/settings-registry.ts`
- `apps/ui/app/components/settings/sinopia-settings.tsx`
- `apps/ui/app/hooks/use-theme.test.tsx`
- `apps/ui/app/i18n/messages/account.ts`
- `apps/ui/app/i18n/messages/auth.ts`
- `apps/ui/app/i18n/messages/common.ts`
- `apps/ui/app/routes/w.$workspace.$project/project-not-found.tsx`

## Passo 8 — Tablet (744–1366 px)

La home e la pagina progetto distinguono telefoni (<744 px), tablet (744–1366 px)
e computer. Il progetto riusa il visore desktop senza rimontarlo al cambio corsia;
Misure e Agente sono fogli laterali esclusivi, con velo leggero, chiusura da tastiera
e barra superiore raggiungibile. La home conserva la hero a tutta larghezza, due
colonne di progetti e l’agente in un foglio da destra. Sotto 744 px compare l’avviso
IT/EN con «Apri Sinopia», senza montare il workspace o il composer della home.

I fogli seguono resize e scroll di `visualViewport`, riducendo l’altezza disponibile
quando si apre la tastiera. Il CSS tablet porta i comandi principali e i campi Misure
ad almeno 44 px e mantiene il testo del composer a 16 px per evitare lo zoom al focus.
Il visore seleziona il pezzo al `contextmenu` nativo del tocco lungo; un eventuale clic
touch successivo seleziona lo stesso pezzo senza deselezionarlo. Picker, controlli
camera, gesti a due dita e relativi blocchi di selezione rimangono i proprietari esistenti.

File principali:

- `apps/ui/app/hooks/use-cad-viewport.ts` e relativo test dei confini e della rotazione.
- `apps/ui/app/components/layout/{tablet-lane,cad-phone-notice}.tsx` e test del foglio.
- `apps/ui/app/routes/w.$workspace.$project/{chat-interface,chat-interface-desktop,project-workspace-context}.tsx` e test dei moduli modificati.
- `apps/ui/app/routes/_index/{sinopia-home,home-recent-projects}.tsx` e test della home.
- `apps/ui/app/i18n/messages/common.ts` (messaggio telefoni IT/EN).
- `apps/ui/app/styles/{global,cad-tablet}.css`.
- `packages/viewer/src/graphics/three/react/gltf-mesh.tsx` e test `gltf-mesh.camera-lifecycle.test.tsx`.
- `apps/ui/app/styles/cad-tablet-targets.browser.test.ts` e `apps/ui/app/styles/cad-tablet-targets.vitest.browser.config.ts`.

La suite separata dei bersagli avvia Chromium direttamente, senza server:
`cd apps/ui && ../../node_modules/.bin/vitest run --config app/styles/cad-tablet-targets.vitest.browser.config.ts --maxWorkers=2`.
Si può indicare un Chromium già installato con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
Nel sandbox corrente il browser termina all’avvio con `bootstrap_check_in: Permission denied`:
i cinque casi dimensionali non sono stati eseguiti. La verifica dell’interfaccia autenticata,
delle dimensioni effettive dopo l’unione e di Safari/tastiera/gesti su iPad vero resta
al coordinatore, come previsto dall’incarico. Non sono stati avviati server né fatte
operazioni Supabase, pubblicazioni o push.

## 23 ottobre 2026 — collegamento ai progetti e alle immagini di Sinopia

I modelli CAD si collegano ai progetti Sinopia tramite un record locale non autore.
Le revisioni vengono archiviate nello storage privato dell'utente; salvataggi concorrenti
richiedono una scelta e conservano la versione alternativa. La home legge i modelli remoti
e i progetti del Creator; le immagini selezionate diventano allegati dell'agente e riferimenti
nel modello. «Invia a Sinopia» prepara STEP, GLB e foto, crea una versione marcata AI e registra
l'invio nelle Versioni. Elenchi, accesso ai modelli e draft della home rispettano il cambio account,
preservando i dati del proprietario. I duplicati ricevono una nuova identità.

Il backup dei file autore continua anche se non è disponibile un'anteprima. Una cattura tardiva
aggiorna soltanto la stessa revisione, verificando account, checkout e geometria effettivamente renderizzata.
La migrazione SQL vive nel repository Sinopia e va applicata separatamente dal fondatore.

File aggiunti o modificati:

- `apps/ui/app/components/chat/new-project-chat-composer.test.tsx`
- `apps/ui/app/components/chat/use-new-project-submit.ts`
- `apps/ui/app/components/machines/machine-project-link.tsx`
- `apps/ui/app/components/project-library/cloud-project-preview.tsx`
- `apps/ui/app/db/home-composer-scope.ts`
- `apps/ui/app/hooks/active-chat-provider.test.tsx`
- `apps/ui/app/hooks/active-chat-provider.tsx`
- `apps/ui/app/hooks/use-cloud-project-preview.test.tsx`
- `apps/ui/app/hooks/use-cloud-project-preview.ts`
- `apps/ui/app/hooks/use-cloud-projects.ts`
- `apps/ui/app/hooks/use-open-cloud-project.test.tsx`
- `apps/ui/app/hooks/use-open-cloud-project.ts`
- `apps/ui/app/hooks/use-project-export.ts`
- `apps/ui/app/hooks/use-project-manager.duplicate.test.ts`
- `apps/ui/app/hooks/use-project-manager.tsx`
- `apps/ui/app/hooks/use-projects.ts`
- `apps/ui/app/hooks/use-sinopia-cad-conflicts.tsx`
- `apps/ui/app/hooks/use-sinopia-cad-sync.test.tsx`
- `apps/ui/app/hooks/use-sinopia-cad-sync.ts`
- `apps/ui/app/hooks/use-sinopia-send-events.test.ts`
- `apps/ui/app/hooks/use-sinopia-send-events.ts`
- `apps/ui/app/hooks/use-thumbnail-generator.test.ts`
- `apps/ui/app/hooks/use-thumbnail-generator.ts`
- `apps/ui/app/i18n/catalog.ts`
- `apps/ui/app/i18n/messages/sinopia-images.ts`
- `apps/ui/app/i18n/messages/sinopia-send.ts`
- `apps/ui/app/i18n/messages/sinopia-sync.ts`
- `apps/ui/app/lib/sinopia-data-client.test.ts`
- `apps/ui/app/lib/sinopia-data-client.ts`
- `apps/ui/app/routes/_index/home-image-drop-zone.tsx`
- `apps/ui/app/routes/_index/home-recent-projects.test.tsx`
- `apps/ui/app/routes/_index/home-recent-projects.tsx`
- `apps/ui/app/routes/_index/sinopia-home.test.tsx`
- `apps/ui/app/routes/_index/sinopia-home.tsx`
- `apps/ui/app/routes/_index/sinopia-project-strip.test.tsx`
- `apps/ui/app/routes/_index/sinopia-project-strip.tsx`
- `apps/ui/app/routes/projects_/cloud-projects.tsx`
- `apps/ui/app/routes/w.$workspace.$project/chat-revisions.test.tsx`
- `apps/ui/app/routes/w.$workspace.$project/chat-revisions.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-command-items.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-route.test.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-route.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-save-status.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-top-bar.test.tsx`
- `apps/ui/app/routes/w.$workspace.$project/project-top-bar.tsx`
- `apps/ui/app/routes/w.$workspace.$project/send-to-sinopia-dialog.test.tsx`
- `apps/ui/app/routes/w.$workspace.$project/send-to-sinopia-dialog.tsx`
- `apps/ui/app/routes/w.$workspace.$project/sinopia-conflict-dialog.tsx`
- `apps/ui/app/services/sinopia-cad-access.test.ts`
- `apps/ui/app/services/sinopia-cad-access.ts`
- `apps/ui/app/services/sinopia-cad-conflicts.ts`
- `apps/ui/app/services/sinopia-cad-restore.test.ts`
- `apps/ui/app/services/sinopia-cad-restore.ts`
- `apps/ui/app/services/sinopia-cad-sync.test.ts`
- `apps/ui/app/services/sinopia-cad-sync.ts`
- `apps/ui/app/services/sinopia-cad-thumbnail.test.ts`
- `apps/ui/app/services/sinopia-cad-thumbnail.ts`
- `apps/ui/app/services/sinopia-cad.test.ts`
- `apps/ui/app/services/sinopia-cad.ts`
- `apps/ui/app/services/sinopia-references.test.ts`
- `apps/ui/app/services/sinopia-references.ts`
- `apps/ui/app/services/sinopia-send.test.ts`
- `apps/ui/app/services/sinopia-send.ts`

Controlli finali dell'incarico: typecheck UI (app e spec) superato; lint sui 63 file TS/TSX
superato con 0 errori e 17 avvisi; 26 suite integrate, 455 test superati. Dopo l'ultima
rinomina locale dell'alias ZIP, ripassati anche i 21 test del servizio di persistenza/importazione.
Revisione indipendente senza rilievi materiali aperti. Tutti i controlli sono stati seriali,
con 4096 MiB di heap e al massimo 2 worker nei test. Nessun server di sviluppo avviato.
Il collaudo SQL non è eseguito: il sandbox impedisce l'avvio del PostgreSQL temporaneo.
La verifica autenticata e visiva resta al coordinatore dopo l'unione; nessuna migrazione
è stata applicata e nessun accesso al database remoto è stato effettuato.

## 24 ottobre 2026 — rifinitura: Sinopia, non Tau

Dopo la prova dal vivo del fondatore («sembra ancora un innesto»; «le funzioni di Tau che servono tienile e
rendile personalizzabili»), modifiche a file di Tau (Apache-2.0 §4(b)):

- **Cornice unica.** `app-sidebar.tsx` mostra su ogni pagina Cerca, Inizio, Progetti, Progetti recenti
  (`home-recent-navigation.tsx`, con il progetto aperto evidenziato) e Strumenti; via «Nuovo progetto»,
  «Altro» e l'albero delle chat. Avvio con il marchio al posto della pagina bianca (`root-layout.tsx`).
- **Strumenti personalizzabili.** Nuovo `use-sinopia-tools.ts` + Impostazioni › Strumenti
  (`settings-registry.ts`, `settings-dialog.tsx`, `sinopia-settings.tsx`): Converti e Importa nella barra,
  Pezzi, Movimento, Dettagli, Stampa 3D (con il flag machines) e Codice del modello con «+» accanto alle Misure.
- **Corsia sinistra.** `chat-workbench-dockview.tsx`, `dockview.tsx`, `dockview-tab.tsx`,
  `with-tab-context-menu.tsx`: schede fisse «Misure» e «Versioni» larghe quanto il testo, senza divisione né
  elenco delle schede; titoli dei pannelli nella lingua dell'interfaccia (`pane-titles.ts`).
- **Agente.** Intestazione «Agente» con nuova conversazione e «Conversazioni precedenti» (`chat-title-bar.tsx`,
  `chat-switcher.tsx`, `chat-display-name.ts`); un'esecuzione salvata su un daemon o un altro agente non è più
  seguita (`sinopia-agent-execution.ts`, `chat-session-store.ts`, `project-live-sessions.tsx`).
- **Misure.** Misure piatte dei modelli vecchi raggruppate per pezzo (`piece-measures.ts`); nota «Tuo valore»
  sobria. Cubo di vista in italiano (`viewport-gizmo-cube-surface.ts`).
- **Pezzi.** Pannello e proprietà in italiano e inglese con nomi leggibili, senza nomi di file
  (`packages/workbench-panes/src/model/*`, `packages/viewer/src/cad/part-*`, `chat-explorer.tsx`).
- **Converti / Importa** in italiano e inglese nella cornice della home; Importa senza GitHub né esempi di codice
  e con i modelli 3D tra i file accettati (`routes/convert/*`, `routes/import.$/*`, `components/geometry/converter/*`).
- **Esporta.** STEP letto per solido e con nomi accentati (`project-export-step.ts`, `smlib.kernel.ts`);
  «Verificato» solo con controllo OCCT standard superato e scarti ≤ 1 µm; Foto pronta subito, catturata al clic.
- **Sinopia.** Modelli senza progetto collegati da soli e una volta sola (`sinopia-cad.ts`,
  `use-sinopia-cad-sync.ts`, `send-to-sinopia-dialog.tsx`, `project-save-status.tsx`); copertine «Da Sinopia»
  (`sinopia-references.ts`); il progetto Sinopia del modello prende l'anteprima come copertina se non ne ha una.

## 26 ottobre 2026 — una sola modalità: ispettore contestuale e assistente sempre presente

Blocchi C1, C2, C5 e D4 del piano di Claude (`PIANO-CLAUDE-2026-10-26.md`), dalla valutazione Fable del 26 ottobre
(§2.1, §2.3, §2.5, §2.8). Modifiche a file di Tau (Apache-2.0 §4(b)):

- **Una sola modalità.** Via l'interruttore Assistente/Modifica e le corsie che si chiudevano da sole
  (`project-workspace-context.tsx`, `chat-interface-desktop.tsx`, `project-top-bar.tsx`). La corsia destra è
  `inspector-lane.tsx`: l'ispettore della selezione (modello, pezzo, faccia, spigoli) con l'ingombro L × P × A letto dal
  solido e modificabile in proporzione, gli strumenti del visore montati lì con un portale (`chat-viewer.tsx`), le misure
  del pezzo (`piece-measures-pane.tsx`, `chat-parameters.tsx`) e la cronologia; sotto, l'assistente sempre presente
  (`components/chat/assistant-dock.tsx`), che si apre nella conversazione con ⌃J (`chat-history.tsx` variante `dock`,
  `chat-title-bar.tsx`). Su tablet la corsia è un foglio richiudibile che lascia usabile il modello sotto
  (`tablet-lane.tsx`).
- **Strumenti per la selezione.** `manual-edit-panel.tsx`: filtro Pezzo · Faccia · Spigolo sempre visibile, strumento
  principale e secondari con icona, «Altri strumenti» nel menu, Applica (Invio) e Annulla (Esc) unici, cronologia che
  dice cosa, quanto e su quale pezzo (`lib/inspector-selection.ts`). La selezione è una sola: un pezzo preso con uno
  strumento diventa la selezione del modello e viceversa (`use-manual-direct-tool.ts`, `use-manual-face-tool.ts`).
- **Selezione visibile e anteprima.** Nel visore (`packages/viewer`): velo e contorno titanio sulla faccia scelta,
  spigoli in titanio, fantasma dell'estrusione di faccia (prisma), del foro (cilindro) e della portata di raccordo e
  smusso (tubo) prima di Applica (`manual-preview-geometry.ts`, `planar-face-controls.tsx`, `direct-edit-controls.tsx`,
  `planar-face-tool.ts`, `direct-edit-tool.ts`, `gltf-mesh.tsx`, `overlay-colors.constants.ts`); la distanza trascinata
  resta in anteprima fino a Invio, con la quota accanto al cursore (`gesture-quota.tsx`). Foro posizionato con un clic
  sulla faccia (`manual-face-draft.ts`, operazione `hole` esistente).
- **Assistente che conosce la selezione.** «Parla di: …» con faccia o spigoli (`selected-piece-chip.tsx`), suggerimenti
  dalla geometria che riempiono il compositore senza inviare (`assistant-suggestions.tsx`, al posto di
  `agent-suggestions.tsx`, rimosso con il suo test), stato vuoto con tre partenze (`chat-history-empty.tsx`,
  `use-home-image-intake.ts`).
- **Versioni parlanti.** Ogni versione dice la misura cambiata con pezzo e valori prima → dopo e le operazioni manuali
  aggiunte, tolte o modificate (`revision-history.ts`, `chat-revisions.tsx`).
- **Tema.** Token `--titanium` e `--titanium-foreground` (`packages/ui/src/styles/tokens.css`, registrati in
  `docs/policy/color-policy.md`); occhielli in mono maiuscolo (`components/ui/eyebrow.tsx`).

## 27 ottobre 2026 — riconoscimento da foto (D2): dalla parte isolata in Sinopia al pezzo di famiglia

- **Contratto con Sinopia.** Modulo nuovo `packages/plugins/smlib/src/riconoscimento/` (esportato come
  `@taucad/smlib/riconoscimento`, `package.json`, `tsdown.config.ts`): scheda della parte e scheda di riconoscimento
  (zod → schema JSON per l'uscita strutturata e limiti a parte), soglie e domande, stima della scala, tabella
  `part_type` → famiglia, prompt e convalida condivisi (`condiviso.ts`, copiato byte per byte nella funzione
  `sinopiacad` di Sinopia con `riconoscimento.contratto.json`), piano di costruzione con il registro delle famiglie,
  aggancio della verifica D3 (`verifica-silhouette.ts`).
- **Marcatore delle ipotesi esteso.** `[sinopia:assumed c= f= min= max=]` con confidenza, fonte e banda plausibile,
  retrocompatibile (`packages/plugins/smlib/src/parameter-assumptions.ts`); le Misure mostrano «stimata ◐» e
  «ipotesi ○» e la banda sul cursore (`apps/ui/app/lib/piece-measures.ts`,
  `apps/ui/app/routes/w.$workspace.$project/piece-measures-pane.tsx`, `packages/ui/src/components/slider-input.tsx`,
  `packages/viewer/src/parameters/{rjsf-context,parameters-widget,parameters-number,parameters-number-field}.ts(x)`).
  I gruppi di una coppia (`tacco` per `Tacco DX`/`Tacco SX`) si agganciano a entrambi i lati.
- **«/cad/nuovo».** Rotta nuova `apps/ui/app/routes/nuovo/` (lettura dei parametri, immagine e maschera da
  `creator-private`, riconoscimento, chip della famiglia, costruzione del progetto), servizi
  `apps/ui/app/services/{sinopia-parts,sinopia-recognize,riconoscimento-immagini,riconoscimento-record,riconoscimento-progetto}.ts`,
  nomi dei parametri in `apps/ui/app/constants/search-parameter.constants.ts`.
- **Ispettore.** Card «Riconosciuto» con parametri, confidenze e domande una alla volta
  (`apps/ui/app/components/riconoscimento/recognition-card.tsx`,
  `apps/ui/app/routes/w.$workspace.$project/{inspector-recognition,inspector-lane}.tsx`); testi in
  `apps/ui/app/i18n/messages/{riconoscimento,measures}.ts` e `catalog.ts`; la skill dell'agente conosce
  `@sinopia/famiglie` e il marcatore esteso (`apps/ui/app/lib/sinopia-immagine-cad-skill.ts`).

## 27 ottobre 2026 — foto del campione (D6) e crediti delle rotte del CAD (E5)

- **Mappe gratis nel browser.** Modulo nuovo `apps/ui/app/lib/foto-campione/`: lettura del GLB presentato in
  triangoli, normali e spigoli B-rep nel telaio di Tau (`glb-mesh.ts`); z-buffer in TypeScript con camera e luce fisse
  per vista (fronte — dall'alto per un pezzo piatto —, 3/4, dettaglio) che dà ombreggiato neutro, profondità, normali,
  bordi e sagoma (`mappe.ts`); impronta SHA-256 di hash del modello + vista + materiale + livello (`impronta.ts`);
  galleria con stati «Pronta»/«Da rifare» e cache per impronta (`galleria.ts`); IoU della sagoma della foto contro
  quella del render, soglia 0,95 (`sagoma.ts`); finto della prova di sviluppo `?prova=foto` (`prova.ts`).
- **Ispettore.** Sezione «Foto del campione» (`apps/ui/app/routes/w.$workspace.$project/{inspector-photos,inspector-lane}.tsx`):
  vista, materiale del pezzo con finitura, livello Standard o Fedele, costo prima del clic, galleria con stato,
  sagoma e «Rigenera»; testi in `apps/ui/app/i18n/messages/foto-campione.ts` e `catalog.ts`.
- **Sinopia.** Client di `POST /v1/photo`, prezzi da `credit_costs`, foto del modello dagli `assets` e scaricamento
  (`apps/ui/app/services/{sinopia-foto,foto-campione-immagini}.ts`); il riconoscimento manda `requestId` e il costo
  mostrato e non chiama finché il prezzo `cad_recognize` non è attivo (`apps/ui/app/services/sinopia-recognize.ts`,
  `apps/ui/app/routes/nuovo/use-riconoscimento-nuovo.ts`, `apps/ui/app/i18n/messages/riconoscimento.ts`).

## 27 ottobre 2026 — schizzo sul modello (E4)

- **Profili su un piano qualsiasi, rivoluzione e sweep.** `packages/plugins/smlib/src/manual-operations.ts`: profilo
  con `frame` (X e normale della faccia scelta) e profilo `path` di linee, archi per tre punti e spline per punti;
  sformo facoltativo dell'estrusione; operazioni `revolve` (asse nel piano dello schizzo) e `sweep` (percorso
  disegnato in un secondo schizzo o spigolo esatto di un pezzo). `manual-evaluator.ts` le costruisce con SMLib;
  test con i volumi attesi in `manual-sketch.test.ts`.
- **Visore.** Geometria pura dello schizzo (snap, spigoli del modello proiettati, chiusura del profilo, rettangolo
  raccordato, arco tangente) in `packages/viewer/src/graphics/three/react/sketch-geometry.ts` con test; contratto
  `sketch-tool.ts`; piano, griglia in mm, entità, regioni chiuse, fantasma e aggancio in `sketch-controls.tsx` e
  `sketch-ghost-geometry.ts`; `gltf-mesh.tsx` e `cad/cad-viewer.tsx` ricevono `sketchTool` (aggiunta); esportati in
  `package.json` e `tsdown.config.ts`.
- **Interfaccia.** Sessione dello schizzo `apps/ui/app/hooks/use-manual-sketch-tool.ts` e logica pura
  `apps/ui/app/services/manual-sketch.ts` (test, e prova sulla fibbia `manual-sketch-buckle.test.ts`); riga dello
  schizzo nella barra del visore `manual-sketch-bar.tsx`, sezione dell'ispettore `manual-sketch-panel.tsx`, quota
  digitabile nel campo della quota al gesto `gesture-quota.tsx`; collegamenti in `chat-viewer.tsx`,
  `manual-edit-panel.tsx` (pulsanti, doppio clic sulla cronologia), `use-manual-face-tool.ts` (faccia scelta),
  `apps/ui/app/lib/inspector-selection.ts` (cronologia), `apps/ui/app/services/manual-profile-editor.ts`; testi in
  `apps/ui/app/i18n/messages/{sketch,manual-edit}.ts` e `catalog.ts`.

## 27 ottobre 2026 — consegna (E3a): STEP, IGES, DXF, GLB con i materiali, tavola PDF, Libreria e preventivo

- **Consegna con SMLib, senza OpenCASCADE.** Modulo nuovo `packages/plugins/smlib/src/consegna/` (esportato come
  `@taucad/smlib/consegna` e `@taucad/smlib/consegna/worker`, `package.json`, `tsdown.config.ts`): worker SMLib suo
  (`consegna.worker.ts`, `client.ts`), STEP riscritto con un prodotto per pezzo (pezzo e materiale nel nome, colore
  del materiale) e riletto con confronto di nomi, solidi, validità stretta e volume contro le Misure (`funzioni.ts`),
  rilettura dell'IGES, DXF (contorno in vera grandezza dei pezzi piani, altrimenti tre viste con le nascoste),
  disegni della tavola (`drawingViews` di smlibwasm 0.5) e percorsi alleggeriti (`percorsi.ts`). Nel kernel
  (`smlib.kernel.ts`) i nomi STEP passano così come sono: smlibwasm 0.5 li codifica da sé.
- **OpenCASCADE: cosa resta.** Solo la conversione STEP → IGES (smlibwasm 0.5 legge l'IGES ma non lo scrive), nello
  stesso worker usa e getta di prima (`apps/ui/app/services/project-export-iges.ts`,
  `apps/ui/app/workers/project-export.{worker,client}.ts`); l'IGES si consegna solo dopo la rilettura SMLib. Il
  controllo OCCT dello STEP (`project-export-step.ts`) resta per i kernel diversi da SMLib (replicad, opencascade).
  Il controllo indipendente di un secondo motore lato server (DESIGN §4.7, Fable §4e) non è in questo blocco.
- **Esporta.** Righe compatte STEP, IGES, DXF, STL, GLB, Foto, Tavola PDF e sezione «Consegna»
  (`apps/ui/app/routes/w.$workspace.$project/project-export-dialog{,-view}.tsx`, `project-delivery-section.tsx`),
  preparazione in `apps/ui/app/services/project-export{,.types,-glb}.ts`, legame col progetto in
  `apps/ui/app/hooks/use-project-{export,delivery}.ts` e `apps/ui/app/lib/consegna.ts`, worker
  `apps/ui/app/workers/consegna.worker.ts`; tavola A4 in `apps/ui/app/services/tavola-pdf.ts` con **pdf-lib** 1.17.1
  (MIT, la stessa versione di Sinopia; `pnpm-workspace.yaml`, `apps/ui/package.json`).
- **Verso Sinopia.** «Invia a Sinopia» porta la tavola PDF, materiale/processo/peso di ogni pezzo
  (`metadata.pezzi`) e la miniatura del modello quando la foto non si invia (`apps/ui/app/services/sinopia-send.ts`,
  `send-to-sinopia-dialog.tsx`); «Salva in Libreria» e «Chiedi preventivo» in
  `apps/ui/app/services/sinopia-consegna.ts`. Testi in `apps/ui/app/i18n/messages/{consegna,export,sinopia-send}.ts`.

## 27 ottobre 2026 — OpenCASCADE solo per l'IGES, con l'avviso di licenza; STEP allegato a «Chiedi preventivo»

- **Scrivere l'IGES senza OpenCASCADE non si può oggi.** smlibwasm 0.5 e smlibpy 0.5 (Apache-2.0/MIT) leggono l'IGES
  ma non lo scrivono: l'elenco dei formati di `exporters` dice «IGES … read», e il nucleo ha solo scrittori interni di
  NLib non esposti. Nel repository le altre librerie IGES sono build di OpenCASCADE (`libcascade`,
  `replicad-opencascadejs`, `occt-import-js`). L'IGES resta quindi su OpenCASCADE.
- **Come lo si usa.** Il modulo è `libcascade` 3.1.0 da npm, non costruito in questo repository: licenza
  `LGPL-2.1-only WITH Open-CASCADE-Exception-1.0`, costruito da `taucad/opencascade.js` (commit 341fa789…) su OCCT
  (commit b8f597c6…) con emscripten 6.0.5, come dice il suo `opencascade_single.provenance.json`. Nella build il glue
  (`opencascade_single.js`) e il WebAssembly (`opencascade_single.wasm`) escono come file a parte, identici byte per
  byte a quelli del pacchetto (SHA-256 confrontati su una build di produzione), caricati per URL dal worker usa e getta
  `apps/ui/app/workers/project-export.worker.ts` (6,5 KB): non modificati e sostituibili. In Esporta la riga IGES ora
  si prepara solo a richiesta («Prepara IGES»), quindi aprire Esporta non carica OpenCASCADE
  (`routes/w.$workspace.$project/project-export-dialog-view.tsx`, `i18n/messages/export.ts`). I motori OpenCASCADE e
  Replicad di Tau e l'import BREP restano come in Tau.
- **Avviso.** «Informazioni» ha la sezione «Componenti di terzi» con l'avviso Open CASCADE (eccezione LGPL), i link
  al sorgente di OCCT e del modulo ai commit della build, alla LGPL 2.1 e all'eccezione, più SMLib e pdf-lib
  (`apps/ui/app/components/nav/about-sinopiacad.tsx`, `i18n/messages/shell.ts`).
- **STEP nella posta.** «Chiedi preventivo» allega lo STEP verificato quando la posta di Sinopia ammette i file CAD
  (`network_cad_attachments_enabled`, rilevamento fail-closed) e il server ne ha letto il contenuto
  (`verifica-allegato-cad`); altrimenti il messaggio di prima (`apps/ui/app/services/sinopia-consegna.ts`,
  `routes/w.$workspace.$project/project-delivery-section.tsx`, `i18n/messages/consegna.ts`).

## 27 ottobre 2026 — foto del campione resa da Sinopia dalla versione inviata (D6, provenienza)

- **Codice gemello delle mappe.** `apps/ui/app/lib/foto-campione/mappe-condivise.ts` (nuovo, al posto di `glb-mesh.ts` e
  `mappe.ts`): lettura del GLB con tetti contro i file ostili, z-buffer, PNG e impronta della foto; lo stesso file vive
  nella funzione `sinopiacad` di Sinopia, che rende le mappe dal GLB inviato. Confronto «modello a schermo = versione
  inviata» per forma (`confronto.ts`).
- **Ispettore.** La foto ritrae l'ultima versione inviata con il GLB; senza invio, o con il modello cambiato dopo
  l'invio, il pulsante chiede «Invia a Sinopia» (`routes/w.$workspace.$project/inspector-photos.tsx`,
  `services/sinopia-foto.ts`, `services/foto-campione-immagini.ts`, `i18n/messages/foto-campione.ts`).
- **Consegna.** Il GLB di un modello SMLib porta la topologia B-rep (`services/project-export.ts`): Sinopia considera
  «generato» solo un pezzo che la porta.

## 27 ottobre 2026 — i worker SMLib partono anche nella build di produzione

- **Causa.** `packages/plugins/smlib/package.json` dichiarava `"sideEffects": false`, ma i moduli
  `src/verifica/verifica.worker.ts` e `src/varianti/varianti.worker.ts` chiamano `expose()` appena importati, e i file
  di worker dell'interfaccia (`apps/ui/app/workers/verifica-silhouette.worker.ts`, `varianti.worker.ts`) li importano
  solo per quell'effetto. In sviluppo Vite non scarta nulla; nella build il bundler ha tolto l'import e i due worker
  uscivano VUOTI (0 byte): nessun «pronto», e dopo 60 s «the worker did not start» (controlli dell'assistente,
  verifica della sagoma D3).
- **Correzione.** `sideEffects` elenca i moduli worker del pacchetto (`./src/**/*.worker.ts`,
  `./dist/**/*.worker.mjs`), che tornano nella build per intero, anche quelli che verranno.
- **Prova.** `scripts/sinopiacad/prova-worker.mjs` (nuovo) serve la build sotto `/cad/` con le intestazioni di
  `vercel/vercel.json`, crea in Chromium headless i worker della producibilità, della verifica, delle varianti e della
  consegna e aspetta il «pronto» di ciascuno (che arriva solo a kernel WebAssembly istanziato); controlla anche che
  nessun `*.worker-*.js` sia vuoto. `scripts/sinopiacad/build.sh` la lancia dopo ogni build e fallisce se un worker
  non risponde.
- **Secondo difetto, stesso sintomo.** Con i worker di nuovo pieni, il primo controllo della fibbia durava 30,5 s
  («fillet: the probe worker did not start within 30 s») e i controlli dell'assistente finivano nel loro timeout di
  30 s. smlibwasm avvia il supervisore del suo worker di sonda quando valuta `dist/_guard.js` e conta che succeda
  prima del `await` di primo livello del kernel; nella build il guardiano era fuso nel chunk `exporters-*`, che importa
  quello del kernel, e partiva solo dopo: il primo raccordo bloccava il thread (`Atomics.wait`) prima che il
  supervisore fosse partito. `apps/ui/vite.config.ts` (`uiWorkerRolldownOptions`), `apps/ui/serve/vite.config.ts` e
  `apps/ui/desktop/vite.config.ts`: nei bundle dei worker il guardiano ha un chunk suo (`smlibwasm-guard-*`), che non
  aspetta il kernel. Il controllo passa da 30 571 ms a circa 550 ms; la prova chiede al worker delle varianti il
  controllo vero di una fibbia e fallisce oltre 15 s o con l'avviso del worker di sonda.

## 27 ottobre 2026 — il salvataggio su Sinopia di un progetto con immagini

- **Causa.** Il salvataggio su Sinopia legge l'ultima revisione come istantanea (`snapshot` del worker del file
  manager, `apps/ui/app/machines/file-manager.worker.revisions.ts`), con ogni file in Base64. `uint8ArrayToBase64` di
  `uint8array-extras` passa 65 535 byte per chiamata come argomenti (`String.fromCodePoint.apply`): lo stack di un worker
  del browser è più piccolo di quello della pagina e trabocca già sopra i 30 000 argomenti («Maximum call stack size
  exceeded»). Un progetto creato dal riconoscimento contiene la foto e la maschera della parte (`riferimenti/`): non si
  salvava mai; uno creato dalla chat, con soli file piccoli, sì.
- **Correzione.** `apps/ui/app/utils/base64.utils.ts` (nuovo): `bytesToBase64` usa `Uint8Array.prototype.toBase64`
  dove c'è, altrimenti blocchi di 6 KiB (multipli di 3 byte), senza ricorsione né liste di argomenti grandi. Il worker
  lo usa per l'istantanea. Le revisioni locali non cambiano: il salvataggio riparte da solo al prossimo tentativo.
- **Prove.** `base64.utils.test.ts` codifica 6 MB in un worker con uno stack da 0,5 MB, dove la chiamata da 65 535
  argomenti trabocca; `file-manager.worker.revisions.test.ts` fa l'istantanea di una revisione con un'immagine di 4 MB.

## 27 ottobre 2026 — la verifica D3 ritrova la vista quando quella dichiarata non spiega la maschera

- **Causa (prove: richiesta e risposta catturate dal worker `verifica-silhouette` sul percorso vero di
  `/cad/nuovo?prova=fibbia`).** L'immagine della differenza mostrava la fibbia di taglio: il riconoscimento chiama
  «fronte» (azimuth 4, elevation 8) la foto della faccia, ma la famiglia `fibbia` giace su XY con la faccia a vista
  +Z, quindi la camera partiva sul fianco del pezzo. I limiti della fase A (±20° di elevation, ±15° di rollo) non
  arrivavano alla vista dall'alto. Il prompt non dice a quale faccia del telaio della famiglia corrisponde la foto, e
  lo stesso vale per placca e pendente. Gli assi della maschera e il fattore di ritaglio erano coerenti.
- **Correzione.** `packages/plugins/smlib/src/verifica/ottimizza.ts`: se dopo gli avvii della vista dichiarata l'IoU
  resta sotto 0,5, la fase A prova le 24 viste lungo gli assi (sei direzioni, quattro rolli), allineate con i momenti.
  Le tre migliori fanno la fase A intera e vince l'obiettivo più basso. Costo: circa 0,3 s, solo quando la vista non
  spiega la maschera.
- **Prova di sviluppo.** `apps/ui/app/routes/nuovo/prova-fibbia.ts`: la fibbia disegnata non era quella del
  riconoscimento registrato. Era larga 444 × 386 px a 11,2 px/mm, cioè 39,6 mm, con l'apertura più larga lungo il
  cinturino che di traverso. Nessuna camera e nessun valore negli intervalli registrati poteva combaciare. Ora è
  disegnata alle misure registrate: luce 20 mm, apertura 14 mm, sezione 3,4 mm, ardiglione ⌀ 2,2 mm in acciaio.
- **Test.** `verifica/vista-assi.test.ts`: una fibbia sintetica fotografata di faccia e dichiarata «fronte» supera
  IoU 0,9 (prima 0,23). Se la vista dichiarata spiega la maschera, resta un avvio solo.

## 27 ottobre 2026 — tassellatura per pezzo, mesh grossa durante il trascinamento, handle del kernel liberati subito

Studio text-to-cad, «Misura del 27 ottobre»: la tassellatura pesava il 47–70 % di una modifica di un parametro e si
rifaceva per intero a ogni modifica e di nuovo nell'export GLB; gli handle di SMLib si liberavano solo col garbage
collector. Numeri prima e dopo nello studio, sezione «Misura dopo la tassellatura».

- **Mesh per pezzo con chiave.** `packages/plugins/smlib/src/utils/mesh-cache.ts` (nuovo): cache LRU delle facce e
  degli spigoli tassellati di ogni pezzo, con tetto di voci e di byte; la chiave è l'impronta del `.smb` binario del
  corpo (hash a 64 bit, meno di 1 ms per modello) più la tolleranza. Le voci tengono solo array JavaScript.
  `utils/render-output.ts`: `render` legge e scrive la cache; nella vista un preset di tolleranza si aggancia a una
  griglia di 16 passi per raddoppio, verso il fine (al massimo 4,4 % più fine di prima, mai più grosso), così una
  piccola modifica della misura complessiva non cambia la tolleranza dei pezzi che restano uguali. Gli export restano
  esatti.
- **Tolleranza adattiva.** Un aggiornamento transitorio può dirsi `interactive` (campione di un trascinamento):
  `packages/runtime/src/client/runtime-document.types.ts`, `runtime-document-session.ts`,
  `types/runtime-document-protocol.schemas.ts`, `framework/kernel-worker.ts`, `framework/kernel-runtime-worker.ts`,
  `types/runtime-middleware-v2.types.ts`, `types/runtime-kernel-v2.types.ts` lo portano fino al `render` del kernel
  come `interaction: 'continuous'`, con una proiezione sua (una mesh grossa non risponde mai per i valori a riposo).
  `smlib.kernel.ts` tassella quei campioni 4 volte più grossi (almeno 30°) in una cache separata.
  `apps/ui/app/machines/cad.machine.ts` manda i campioni dello scrub come interattivi;
  `apps/ui/app/routes/w.$workspace.$project/chat-parameters.tsx` rimanda l'ultimo campione come fermo dopo 250 ms
  senza movimento, e il rilascio conferma come prima. `packages/plugins/middleware/src/geometry-cache.middleware.ts`
  non salva la mesh di un campione interattivo.
- **Export GLB.** `smlib.kernel.ts`: l'export legge la cache fine; riusa la mesh dell'anteprima quando la tolleranza
  coincide, e le sue mesh di export dei pezzi non cambiati.
- **Handle.** `smlib.kernel.ts`: `releaseHandle` libera i corpi di una costruzione sostituita; STEP, STL e la
  serializzazione lavorano dentro `lib.scope`. `utils/render-output.ts`: ogni pezzo si tassella dentro `lib.scope`.
  `famiglie/modulo.ts`: costruzioni e verifiche delle famiglie dentro `lib.scope`.
- **Test.** `utils/mesh-cache.test.ts`, `smlib.tassellatura.test.ts` (nuovi), `famiglie/ricostruzione.bench.test.ts`
  (come l'app: spigoli nella vista, topologia nell'export, valori sempre nuovi, mesh confrontate),
  `packages/runtime/src/framework/kernel-worker.parameter-commit.test.ts`,
  `client/runtime-document-session.test.ts`, `types/runtime-document-protocol-payload-shape.test.ts`,
  `packages/plugins/middleware/src/geometry-cache.middleware.test.ts`, `apps/ui/app/machines/cad.machine.test.ts`,
  `apps/ui/app/routes/w.$workspace.$project/chat-parameters.test.tsx`.

## 27 ottobre 2026 — il CAD mentre nasce: «Cantiere» e «Montaggio»

Mentre l'agente costruisce un modello da zero il riquadro 3D non resta vuoto, e i pezzi del primo modello entrano uno
alla volta. Tutto viene da ciò che il turno porta già (chiamate di strumenti e testo dell'agente): nessuna chiamata in
più al modello, nessun cambio alle istruzioni, nessuna attesa.

- **Montaggio nel visore.** `packages/viewer/src/graphics/three/react/model-assembly.ts` (nuovo, esportato da
  `package.json` e costruito da `tsdown.config.ts`): l'host lo arma, il visore lo suona; un primo modello dopo nessuno
  entra un pezzo alla volta (al massimo 3 s in tutto), poi i nomi restano per un momento e il montaggio finisce.
  `gltf-mesh.tsx`: offre ogni presentazione al montaggio prima del primo fotogramma, nasconde solo nel disegno i pezzi
  non ancora entrati (lo stato di interazione li tiene tutti: selezione, misure, conteggi ed export non cambiano),
  disegna tutto subito se si sceglie un pezzo non entrato e misura dove cade ogni pezzo entrato sul canvas.
  `cad/cad-viewer.tsx`: passa il montaggio.
- **Cantiere e nomi dei pezzi nell'app.** `apps/ui/app/lib/cantiere.ts` (nuovo): i passi dell'agente dalle sue
  chiamate, l'ingombro letto dal suo testo («telaio 38 × 32 mm», «x», virgola decimale, cm) e la regola «montaggio
  solo al primo modello dell'assistente nel turno». `apps/ui/app/lib/montaggio.ts` (nuovo): nome e misura principale
  di un pezzo (dai parametri come le Misure, altrimenti dall'ingombro) e posa delle etichette.
  `apps/ui/app/routes/w.$workspace.$project/viewer-cantiere.tsx` (nuovo): il livello sopra il canvas, senza clic e
  sotto la barra del riquadro. `chat-viewer.tsx`: un montaggio per riquadro, il livello nel modo editor, un clic sul
  riquadro durante il montaggio mostra tutto. `apps/ui/app/i18n/messages/cantiere.ts` (nuovo) e `i18n/catalog.ts`.
- **Test.** `packages/viewer/src/graphics/three/react/model-assembly.test.ts`, `gltf-mesh.assembly.test.tsx`,
  `apps/ui/app/lib/cantiere.test.ts`, `apps/ui/app/lib/montaggio.test.ts`,
  `apps/ui/app/routes/w.$workspace.$project/viewer-cantiere.test.tsx` (nuovi).

## 29 ottobre 2026 — tacchi da foto: ricetta v2 del tacco

Visto dal vivo su sinopialab.com/cad: uno stiletto riconosciuto da foto usciva come una «tromba» attorcigliata (seduta
55 × 48 piana, parete della cavità 0,01 mm, 9 facce in sottosquadro), un tacco a blocco come una colonna dritta.

- **Cause.** (1) La legge della forma: sezioni ellittiche centrate su un asse e scalate uguali davanti e dietro, con la
  vita a metà altezza larga il 45 % della seduta: dorso e petto si aprivano simmetrici, un imbuto. Un tacco si disegna
  con due linee di fianco indipendenti (dorso lungo e quasi dritto, petto che si apre ad arco sotto la seduta) più la
  larghezza vista da dietro. (2) La seduta era un piano, mai concava, inclinata al più di 15° (uno stiletto alto ne ha
  25–32). (3) Il loft univa sezioni di topologia diversa (ellisse del tappo, scudo o rettangolo della seduta): partenze
  diverse delle curve, superficie attorcigliata. (4) La cavità era un secondo loft su stazioni diverse da quelle del
  corpo, estratta lungo Z sotto una seduta inclinata: le due superfici divergevano fino a toccarsi, e le pareti vicino
  al bordo finivano a cuneo contro la seduta. (5) Nel piano di costruzione un valore «non visibile» (il predefinito della
  scheda ripetuto dal modello) sovrascriveva quello della variante.
- **Forma.** `packages/plugins/smlib/src/famiglie/tacco-profilo.ts` (nuovo): la legge pura (dorso, petto, larghezza,
  pianta a superellisse con dorso tondo e petto dritto per lo scudo, seduta per B e F scavata in lungo e in largo, perno,
  cavità, profondità dei fori), con test senza kernel `tacco-profilo.test.ts`. `famiglie/tacco.ts` (ricetta v2): loft
  liscio di sezioni orizzontali, ognuna una spline chiusa per gli stessi 16 punti (niente torsione), stazioni a densità
  dolce (fitte dove il tacco si apre), seduta tagliata da un solo utensile, cavità di superellissi annidate parallele
  alla seduta ed estratte lungo la sua normale (parete per erosione con una sfera, sformo per costruzione, colonne come
  fori delle sezioni), cavità tolta sotto i 10 mm, fori di fissaggio lungo la normale e mai fuori dal fianco, smusso del
  tappo al posto del raccordo, vita del rocchetto più stretta del tappo. Parametri invariati nelle chiavi; descrizioni,
  predefiniti (seduta a scudo, inclinazione 14°, vita 0,3, bombature 0) e `seduta.inclinazione` fino a 35° (ora
  sensibile alla sagoma). Verifiche: sformo della cavità lungo la normale della seduta, perno contro il contorno vero.
- **Riconoscimento.** `riconoscimento/costruisci.ts`: i valori «non visibili» lasciano il predefinito della variante;
  l'ipotesi tiene il motivo del modello (test in `costruisci.test.ts`). `riconoscimento.contratto.json` rigenerato
  (scheda della famiglia tacco v2), impronta in `contratto.test.ts`, istantanea del prompt in
  `__snapshots__/prompt.test.ts.snap`. **La copia gemella in Sinopia** (`supabase/functions/sinopiacad/riconoscimento/
contratto.json` e l'impronta in `recognize.test.ts`) va aggiornata con la funzione `sinopiacad`: fino ad allora il
  riconoscimento usa la scheda v1 (inclinazione tagliata a 15°), e la ricetta v2 legge comunque quei valori.
- **Altri test.** `famiglie/tacco.test.ts` riscritto (casi dei due progetti visti dal vivo, seduta scavata, simmetria,
  sformo lungo la normale), `famiglie/modulo.test.ts` (confronto dei volumi su tacchi pieni),
  `verifica/ottimizza.test.ts` e `verifica/osservabilita.test.ts` (stiletti sintetici 13 e 103: con il fusto sottile la
  fase A della verifica D3 gira la camera di 10–19° in alcuni casi, vedi i commenti); `famiglie/index.ts` esporta i
  tipi dal profilo.
