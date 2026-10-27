/**
 * Entry of the D3 check's dedicated worker (SinopiaCAD silhouette ↔ mask): it only loads `@taucad/smlib/verifica/worker`,
 * which exposes the check with a kernel of its own. A file of the app so the bundler sees one worker entry; the
 * reasons for a worker apart from the project's kernel are written in that module.
 */
import '@taucad/smlib/verifica/worker';
