#!/usr/bin/env bash
# Purpose: Re-emit a spike's summary text as GitHub notice annotations, so the numbers are readable
#   through the check-runs REST API where artifact and log downloads are unavailable.
# Environment: a GitHub Actions step (workflow commands on stdout). At most 9 notices per call.
# Usage: scripts/spikes/native-deps/linux/annotate.sh <title> <file>
# Exit codes: 0 summary emitted (or missing/empty), 1 read failure, 2 usage.
# Node is supplied by setup-nx on both Linux and macOS; no GNU-only text tools are needed.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <title> <file>" >&2
  exit 2
fi
node --input-type=module - "$1" "$2" <<'NODE'
import { readFileSync } from 'node:fs';

// Return normally so Node drains stdout when annotations are piped to a slower reader.
const annotate = () => {
  const [title, file] = process.argv.slice(2);
  const escapeData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const property = escapeData(title).replaceAll(':', '%3A').replaceAll(',', '%2C');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`::warning title=${property}::no summary file ${escapeData(file)}`);
    return;
  }
  // Bound notices by UTF-8 bytes without splitting a code point. Keep the nine-notice cap.
  let body = '';
  let bytes = 0;
  let index = 0;
  const emit = () => {
    index += 1;
    console.log(`::notice title=${property} (${index})::${escapeData(body)}`);
    body = '';
    bytes = 0;
  };
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 3800) {
      emit();
      if (index === 9) {
        console.log(`::warning title=${property}::summary truncated after 9 notices`);
        return;
      }
    }
    body += character;
    bytes += size;
  }
  if (body) emit();
};
annotate();
NODE
