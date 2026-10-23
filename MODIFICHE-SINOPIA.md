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
