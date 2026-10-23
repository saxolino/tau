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
