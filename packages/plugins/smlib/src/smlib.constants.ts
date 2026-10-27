/**
 * Browser-safe SMLib kernel metadata shared by registration adapters.
 */

/**
 * Module specifier SMLib authors import the modeling API from.
 * @public
 */
export const smlibModuleName = '@classcad/smlibwasm';

/**
 * Canonical regex for detecting smlibwasm usage in source code.
 *
 * Branches: ESM import of the SinopiaCAD families module (built on SMLib), ESM import, CJS require, dynamic import,
 * JSDoc typedef.
 * @public
 */
export const smlibDetectPattern =
  /import\s[^;]*?from\s+["']@sinopia\/famiglie["']|import\s[^;]*?from\s+["']@classcad\/smlibwasm["']|require\s*\(\s*["']@classcad\/smlibwasm["']\s*\)|import\s*\(\s*["']@classcad\/smlibwasm["']\s*\)|@typedef.*import\s*\(\s*["']@classcad\/smlibwasm["']\s*\)/s;

/**
 * Module specifier of the SinopiaCAD parametric families (heels, buckles, plates…), a built-in module of the SMLib
 * kernel: a project's `main.ts` imports a family from it and calls its recipe.
 * @public
 */
export const sinopiaFamiglieModuleName = '@sinopia/famiglie';
