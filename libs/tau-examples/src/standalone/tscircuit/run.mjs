// Renders main.tsx outside Tau with the project's own @tscircuit/core and writes its Circuit JSON. The JSX is
// compiled with the project's own TypeScript (a peer of @tscircuit/core), as `tsc` would.
// Usage (after `npm ci --ignore-scripts`): node run.mjs <circuit.json>
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { RootCircuit } from '@tscircuit/core';
import { createElement } from 'react';
import ts from 'typescript';

const compiled = new URL('main.tsx.mjs', import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(new URL('main.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
writeFileSync(compiled, outputText);
try {
  const { default: Board } = await import(compiled.href);
  const circuit = new RootCircuit();
  circuit.add(createElement(Board));
  await circuit.renderUntilSettled();
  writeFileSync(process.argv[2], `${JSON.stringify(circuit.getCircuitJson(), undefined, 2)}\n`);
} finally {
  rmSync(compiled, { force: true });
}
