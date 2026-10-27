#!/bin/zsh
# Costruisce SinopiaCAD e lo pubblica su Vercel (progetto «sinopiacad», alias sinopiacad.vercel.app), da cui
# sinopialab.com/cad lo legge con una riscrittura. La build va in <cartella>/cad/, così i percorsi richiesti dal
# proxy (/cad/assets/…) coincidono con i file veri.
# Il login a Vercel è quello della CLI (`vercel login`); nessun token è scritto qui.
# Uso: scripts/sinopiacad/pubblica.sh
set -euo pipefail
cd "${0:A:h}/../.."
scripts/sinopiacad/build.sh
out=apps/ui/serve/build/client
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/cad" "$stage/.vercel"
cp -R "$out/." "$stage/cad/"
# Le mappe dei sorgenti servono solo a Sentry, che SinopiaCAD non usa: non si pubblicano.
find "$stage/cad" -name '*.map' -delete
cp scripts/sinopiacad/vercel/vercel.json "$stage/"
# Identificativi (non segreti) del progetto Vercel esistente; sovrascrivibili da ambiente.
printf '{"projectId":"%s","orgId":"%s","projectName":"sinopiacad"}' \
  "${VERCEL_PROJECT_ID:-prj_fQamo7fnSHUSrL8QOrAk7ABY45Ph}" \
  "${VERCEL_ORG_ID:-team_6EzHIjSMGoaJvELhzw7TaMOq}" > "$stage/.vercel/project.json"
cd "$stage"
vercel deploy --prod --yes
