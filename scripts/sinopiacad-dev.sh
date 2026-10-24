#!/usr/bin/env bash
# Avvio locale di SinopiaCAD (porta 4310), collegato alla funzione «sinopiacad» di Sinopia.
# L'API è la funzione Supabase (catalogo modelli, proxy LLM, dettatura) e l'accesso è l'account Sinopia.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="/Users/torresi.studio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export NX_DAEMON=false NX_NO_CLOUD=true
export TAU_API_URL=https://zixducvzqlgpvurbqfuz.supabase.co/functions/v1/sinopiacad
# Nessun server WebSocket: l'indirizzo resta locale e inattivo, serve solo a superare la validazione.
export TAU_WEBSOCKET_URL=ws://127.0.0.1:4401
export TAU_FRONTEND_URL=http://127.0.0.1:4310 TAU_CLOUD_ENABLED=false TAU_ACQUISITION=locked
# Progetto Supabase di Sinopia: URL e chiave pubblicabile (anon), pubbliche per natura, le stesse di sinopialab.com.
export SINOPIA_SUPABASE_URL=https://zixducvzqlgpvurbqfuz.supabase.co
export SINOPIA_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppeGR1Y3Z6cWxncHZ1cmJxZnV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMDc1MDksImV4cCI6MjA4MDY4MzUwOX0.FjdIR0EALOAiWiu0kzyLMrHLLVZuCkPKfptguBsefmc
exec corepack pnpm@11.7.0 nx dev ui --port=4310 --host=127.0.0.1
