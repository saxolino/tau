# Page header review — PR 600

Actual Chromium captures of Tau's production UI build for [PR 600](https://github.com/taucad/tau/pull/600).

- UI source: `b1c66e15ab1b00db26c56ad855258f4de43b4885`.
- Capture run: https://github.com/taucad/tau/actions/runs/38498769820.
- The workflow checks that `apps/ui` and `apps/ui-e2e` match the source commit before building.
- Light desktop: 1440×1000. Dark narrow mobile: 320×720. Additional dark mobile: 390×844. Wide desktop comparison: 2560×1440. Form interaction check: 1280×720.
- The signed-out session endpoint is fulfilled with `null` in the browser fixture. The invitation screenshot renders the real signed-out notice and desktop handoff. GitHub completion is the real incomplete-return state. No project is created and no live account is connected.
- GeoSpec is enabled for the diagnostic route. Its performance is not benchmarked; the runner uses a software graphics backend.

`measurements.json` records headings, landmarks and document/page-scroll overflow. `interactions.json` records the short-desktop form, mobile accordion/actions, cookie-preferences dialog and wide-header parity checks. `manifest.json` records image hashes.

The screenshot driver and workflow live only on this evidence branch, outside the implementation PR. Screenshots are embedded in the PR description with immutable commit URLs.
