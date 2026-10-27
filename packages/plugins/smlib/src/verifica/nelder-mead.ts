/**
 * Nelder–Mead nostro con limiti (specifica D3, §3.4, task T-D3-04), senza dipendenze.
 *
 * Le variabili vivono in [0, 1] (ogni parametro normalizzato con il suo min/max): ogni punto di prova è proiettato
 * nell'intervallo, così l'ottimizzatore non chiede mai un parametro fuori dai limiti della famiglia. Coefficienti
 * adattivi alla dimensione (Gao e Han, 2012: con 8–15 variabili il simplesso classico si appiattisce), che per n = 2
 * coincidono con quelli classici (1, 2, ½, ½).
 *
 * Arresto: valutazioni esaurite, simplesso ridotto (|Δf| e diametro sotto le tolleranze), oppure `arresto(stato)` vero
 * dopo una valutazione (soglia di IoU raggiunta, ristagno, tempo, `AbortSignal`: li decide il chiamante).
 */

export type StatoNelderMead = {
  /** Valutazioni fatte. */
  valutazioni: number;
  /** Migliore punto visto finora (in [0, 1]ⁿ). */
  migliore: readonly number[];
  fMigliore: number;
  /** Ultimo punto valutato e il suo valore. */
  ultimo: readonly number[];
  fUltimo: number;
};

export type OpzioniNelderMead = {
  /** Lato del simplesso iniziale per variabile (unità normalizzate; predefinito 0,1). */
  passo?: number | readonly number[];
  valutazioniMassime: number;
  /** Arresto se max f − min f del simplesso è sotto questa soglia (predefinito 1e-10). */
  tolleranzaF?: number;
  /** Arresto se il simplesso sta in un cubo di questo lato (predefinito 1e-8). */
  tolleranzaX?: number;
  /** Arresto anticipato deciso dal chiamante, chiamato dopo ogni valutazione. */
  arresto?: (stato: StatoNelderMead) => boolean;
};

export type RisultatoNelderMead = {
  x: number[];
  f: number;
  valutazioni: number;
  motivo: 'convergenza' | 'valutazioni' | 'arresto';
};

const limita01 = (x: readonly number[]): number[] => x.map((v) => Math.min(1, Math.max(0, v)));

class ArrestoAnticipato extends Error {}

/**
 * Minimizza `f` in [0, 1]ⁿ partendo da `x0`.
 * @param f - Funzione obiettivo (riceve sempre un punto dentro i limiti).
 * @param x0 - Punto di partenza (proiettato nei limiti).
 * @param opzioni - Passo iniziale, valutazioni massime, tolleranze, arresto anticipato.
 * @returns Il migliore punto trovato, il suo valore, le valutazioni e il motivo dell'arresto.
 */
export function nelderMead(
  f: (x: readonly number[]) => number,
  x0: readonly number[],
  opzioni: OpzioniNelderMead,
): RisultatoNelderMead {
  const n = x0.length;
  const tolleranzaF = opzioni.tolleranzaF ?? 1e-10;
  const tolleranzaX = opzioni.tolleranzaX ?? 1e-8;
  const [alfa, gamma, rho, sigma] = n <= 2 ? [1, 2, 0.5, 0.5] : [1, 1 + 2 / n, 0.75 - 1 / (2 * n), 1 - 1 / n];
  let valutazioni = 0;
  let migliore = limita01(x0);
  let fMigliore = Infinity;
  const valuta = (x: readonly number[]): number => {
    if (valutazioni >= opzioni.valutazioniMassime) {
      throw new ArrestoAnticipato('valutazioni');
    }
    const punto = limita01(x);
    const valore = f(punto);
    valutazioni++;
    const confrontabile = Number.isNaN(valore) ? Infinity : valore;
    if (confrontabile < fMigliore) {
      [migliore, fMigliore] = [punto, confrontabile];
    }
    if (opzioni.arresto?.({ valutazioni, migliore, fMigliore, ultimo: punto, fUltimo: confrontabile })) {
      throw new ArrestoAnticipato('arresto');
    }
    return confrontabile;
  };
  const esito = (motivo: RisultatoNelderMead['motivo']): RisultatoNelderMead => ({
    x: [...migliore],
    f: fMigliore,
    valutazioni,
    motivo,
  });
  try {
    if (n === 0) {
      valuta([]);
      return esito('convergenza');
    }
    // Simplesso iniziale: x0 e un vertice per asse, verso l'interno se il passo uscirebbe dai limiti.
    const partenza = limita01(x0);
    const vertici: number[][] = [partenza];
    for (let i = 0; i < n; i++) {
      const passo = Array.isArray(opzioni.passo) ? (opzioni.passo[i] ?? 0.1) : ((opzioni.passo as number) ?? 0.1);
      const vertice = [...partenza];
      vertice[i] = partenza[i]! + passo <= 1 ? partenza[i]! + passo : partenza[i]! - passo;
      vertici.push(limita01(vertice));
    }
    const valori = vertici.map((vertice) => valuta(vertice));
    for (;;) {
      const ordine = valori.map((_, indice) => indice).sort((a, b) => valori[a]! - valori[b]!);
      const ordinati = ordine.map((indice) => vertici[indice]!);
      const ordinatiValori = ordine.map((indice) => valori[indice]!);
      vertici.splice(0, vertici.length, ...ordinati);
      valori.splice(0, valori.length, ...ordinatiValori);
      const diametro = Math.max(
        ...vertici.slice(1).map((vertice) => Math.max(...vertice.map((v, i) => Math.abs(v - vertici[0]![i]!)))),
      );
      if (valori[n]! - valori[0]! <= tolleranzaF && diametro <= tolleranzaX) {
        return esito('convergenza');
      }
      const centroide = Array.from({ length: n }, (_, i) => {
        let somma = 0;
        for (let k = 0; k < n; k++) {
          somma += vertici[k]![i]!;
        }
        return somma / n;
      });
      const peggiore = vertici[n]!;
      const verso = (t: number): number[] => limita01(centroide.map((c, i) => c + t * (c - peggiore[i]!)));
      const riflesso = verso(alfa);
      const fRiflesso = valuta(riflesso);
      if (fRiflesso < valori[0]!) {
        const espanso = verso(alfa * gamma);
        const fEspanso = valuta(espanso);
        [vertici[n], valori[n]] = fEspanso < fRiflesso ? [espanso, fEspanso] : [riflesso, fRiflesso];
        continue;
      }
      if (fRiflesso < valori[n - 1]!) {
        [vertici[n], valori[n]] = [riflesso, fRiflesso];
        continue;
      }
      // Contrazione: esterna se il riflesso migliora il peggiore, altrimenti interna.
      const esterna = fRiflesso < valori[n]!;
      const contratto = verso(esterna ? alfa * rho : -rho);
      const fContratto = valuta(contratto);
      if (fContratto < (esterna ? fRiflesso : valori[n]!)) {
        [vertici[n], valori[n]] = [contratto, fContratto];
        continue;
      }
      // Restringimento verso il migliore.
      for (let k = 1; k <= n; k++) {
        vertici[k] = limita01(vertici[0]!.map((v, i) => v + sigma * (vertici[k]![i]! - v)));
        valori[k] = valuta(vertici[k]!);
      }
    }
  } catch (error) {
    if (error instanceof ArrestoAnticipato) {
      return esito(error.message as 'valutazioni' | 'arresto');
    }
    throw error;
  }
}
