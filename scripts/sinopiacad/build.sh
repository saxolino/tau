#!/bin/zsh
# Build statica di SinopiaCAD per https://sinopialab.com/cad (SPA, senza server).
# Le variabili pubbliche (URL della funzione, URL e chiave pubblica di Supabase) restano quelle di
# scripts/sinopiacad-dev.sh; cambiano solo gli indirizzi del sito e il sottopercorso. Nessun segreto qui.
# Uso: scripts/sinopiacad/build.sh   → apps/ui/serve/build/client
set -euo pipefail
cd "${0:A:h}/../.."
source <(grep -E '^export (PATH|NX_DAEMON|TAU_API_URL|SINOPIA_SUPABASE_URL|SINOPIA_SUPABASE_PUBLISHABLE_KEY)' scripts/sinopiacad-dev.sh)
export SINOPIACAD_ORIGINE="${SINOPIACAD_ORIGINE:-https://sinopialab.com}"
# Sottopercorso: Vite `base` (con la barra finale); il `basename` del router è lo stesso senza barra.
export SINOPIACAD_BASE="${SINOPIACAD_BASE:-/cad/}"
export TAU_FRONTEND_URL="$SINOPIACAD_ORIGINE"
# Usato solo dal motore Zoo, escluso in SinopiaCAD: deve essere un URL valido.
export TAU_WEBSOCKET_URL="wss://${SINOPIACAD_ORIGINE#https://}/ws"
export TAU_CLOUD_ENABLED=false TAU_ACQUISITION=locked NODE_ENV=production
corepack pnpm@11.7.0 nx run ui:build:serve --skip-nx-cache
