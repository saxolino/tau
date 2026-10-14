# Complete UI page stocktake

## Methodology

Enumerated React Router route modules, route-rendered child components, shell handles, desktop route substitutions, all raw h1 elements, PageHeader/PageContent callers and route-owned max-width recipes. Classified full-screen task/status surfaces separately from pages inside the navigation shell. Inspected current source, not only the supplied screenshots. Browser verification and results are recorded separately after execution.

## Findings

Root cause: the earlier migration covered collection routes but left standalone forms, documents and status routes outside PageContent/PageHeader. Duplicated breadcrumb handles also re-enabled a bordered shell strip. The shared owners exist already, so adopting them is sufficient; no new page framework is needed.

| Route / surface | Baseline | Action |
| --- | --- | --- |
| /community | Shared frame and title; reference presentation | Preserve |
| /projects | Shared frame/title via ProjectLibrary | Preserve standalone h1; permit h2 when embedded |
| /files | Shared frame/title, fills available height | Preserve |
| /parts | Shared frame/title including unavailable state | Preserve |
| /convert | Shared frame/title including loading state | Preserve |
| /import/* | Shared frame/title in input, error, processing and main-file selection | Preserve |
| /plugins | Shared frame/title | Preserve |
| /usage | Shared frame/title, cloud-gated | Preserve |
| /projects/new | Centered 30px/600 heading, max-w-4xl, no top inset, breadcrumb strip | PageContent fill variant, PageHeader, page meta; neutral picker states; sentence case |
| /workflows | Centered 60px title and breadcrumb strip | Shared frame/title, page meta, compact pending content |
| /legal | Serif/italic centered hero with duplicated gutters and narrower frame | Shared title and outer PageContent; neutral card hover |
| /legal/terms | Markdown 30px/bold title, inherited narrow frame and breadcrumb | LegalDocument shared title, retained source text and fragment, readable left-aligned body, page meta |
| /legal/privacy | Same | Same |
| /legal/cookies | Same; preferences dialog from hash | Same; preserve preferences interaction |
| /legal/acceptable-use | Same | Same |
| /legal/subprocessors | Same | Same |
| /legal/open-source | Same | Same |
| /github/complete | Centered 20px title, nested main, no meta | Shared frame/title, single shell landmark, retain outcome/return behavior |
| /invitations/:token | No h1, unframed centered notice, no meta | Shared frame and stable Project invitation title, retain notice/actions |
| /loader | Bespoke 48px heading, narrow max-w-6xl frame and breadcrumb | Shared frame/title; preserve gallery content |
| /loader/glass | Same | Same |
| /debug/geospec | Bespoke 24px heading, nested main, no route scrolling/meta | Shared frame/title and shell scrolling; preserve performance lab |
| / (signed-in web, desktop) | Composer h1 plus Projects h1 | Preserve composer presentation; embedded Projects becomes h2 |
| / (legacy flag variant) | Composer h1 plus community h1 | Community section becomes h2 |
| / (anonymous marketing), /vision | Intentional marketing heroes and their own composition | Retain display typography |
| /w/:workspace/:project | Full-height editor, shell header deliberately off | Retain pane headers |
| /w/:workspace/:project/preview | Viewer toolbar/breadcrumb and canvas workspace | Retain viewer composition |
| /s/:slug (web/desktop) | Shared project viewer, password/refusal and desktop handoff states | Retain task-specific viewer/access layouts |
| /auth/*, /auth/desktop, /connect/github-gist | Wrapper-less authentication/authorization cards | Retain compact standalone task layouts |
| /* and ErrorPage | Recovery states, centered 404/error notice rather than a product task page | Retain dedicated recovery composition |
| /settings, /settings/* | Redirect into settings dialog | No independent page header |
| /i/* | Server redirect | No rendered page |
| /assets/*, /api/ph/*, /health.*, /manifest.webmanifest, /robots.txt, /sitemap.xml, /action/set-theme | Resource/action endpoints | No rendered page |
| /__e2e/* | Test fixture routes | Excluded from product page migration |

## Acceptance

- All migrated shell pages use the existing shared frame and title typography.
- New Project retains location choice, keyboard submission, kernel selection, responsive accordion/list and reachable create/cancel actions.
- Legal source bytes and document fragment links stay intact.
- Desktop keeps its shared route modules and intentionally omits web legal pages.
- One page h1 on composed home surfaces.
- Verify desktop/mobile and light/dark captures, focused tests, lint and ui typecheck; inspect PR checks until settled. Do not merge.
