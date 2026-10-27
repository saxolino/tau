/**
 * Worker delle varianti e dei controlli dell'assistente (SinopiaCAD D4, D5), con un kernel SMLib suo.
 *
 * Come quello della verifica D3 (`verifica.worker.ts`) e per le stesse ragioni: tre costruzioni, tre verifiche e tre
 * rese di seguito (1–3 s) non si mettono in coda alle valutazioni del modello nel worker del kernel del progetto, e
 * fra i thread passano solo parametri, esiti e PNG. Si crea al primo controllo e vive con la pagina del progetto.
 */
import { expose } from '@classcad/smlibwasm/worker';

expose(async () => {
  const [lib, { funzioniVarianti }] = await Promise.all([
    import('@classcad/smlibwasm'),
    import('#varianti/varianti-funzioni.js'),
  ]);
  return funzioniVarianti(lib);
});
