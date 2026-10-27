/**
 * Percorsi SVG dei disegni della tavola (E3a), resi leggeri. `toSvg` di SMLib scrive esatti rette e archi di cerchio
 * e come polilinee fitte le altre curve (raccordi su superfici libere, bombature): una fibbia bombata dà milioni di
 * caratteri, che il PDF non regge e che a stampa non si distinguono. Qui ogni polilinea si sfoltisce entro una
 * tolleranza (Ramer–Douglas–Peucker, iterativo) e i percorsi si spezzano in pezzi brevi; rette isolate e archi restano
 * come sono.
 */

type Punto = readonly [number, number];

/** Un comando del percorso: `M`/`L` con un punto, `A` con i suoi sette numeri, `Z`. */
type Comando =
  | Readonly<{ tipo: 'M' | 'L' | 'Z' } & { punto?: Punto }>
  | Readonly<{ tipo: 'A'; numeri: readonly number[] }>;

const numero = (valore: number): string => {
  const testo = valore.toFixed(4).replace(/\.?0+$/u, '');
  return testo === '-0' ? '0' : testo;
};

/**
 * Legge un percorso fatto di `M`, `L`, `A` e `Z` (come lo scrive `toSvg`). Un comando diverso, o numeri che non tornano,
 * danno `undefined`: il percorso si lascia com'è.
 * @param percorso - Il `d` del percorso.
 * @returns I comandi, o `undefined`.
 */
function leggi(percorso: string): Comando[] | undefined {
  const comandi: Comando[] = [];
  const pezzi = percorso.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gu) ?? [];
  let indice = 0;
  const prossimo = (): number | undefined => {
    const valore = pezzi[indice];
    if (valore === undefined || /[A-Za-z]/u.test(valore)) {
      return undefined;
    }
    indice += 1;
    return Number(valore);
  };
  const punto = (): Punto | undefined => {
    const x = prossimo();
    const y = prossimo();
    return x === undefined || y === undefined ? undefined : [x, y];
  };
  while (indice < pezzi.length) {
    const tipo = pezzi[indice]!;
    indice += 1;
    switch (tipo) {
      case 'M':
      case 'L': {
        const letto = punto();
        if (!letto) {
          return undefined;
        }
        comandi.push({ tipo, punto: letto });
        break;
      }
      case 'A': {
        const numeri = Array.from({ length: 7 }, prossimo);
        if (numeri.some((valore) => valore === undefined)) {
          return undefined;
        }
        comandi.push({ tipo, numeri: numeri as number[] });
        break;
      }
      case 'Z':
      case 'z': {
        comandi.push({ tipo: 'Z' });
        break;
      }
      default: {
        return undefined;
      }
    }
  }
  return comandi;
}

/**
 * I punti da tenere di una polilinea, entro `tolleranza` dalla linea originale.
 * @param punti - La polilinea.
 * @param tolleranza - Lo scarto massimo.
 * @returns I punti tenuti, primo e ultimo compresi.
 */
function sfoltisci(punti: readonly Punto[], tolleranza: number): Punto[] {
  if (punti.length <= 2) {
    return [...punti];
  }
  const tieni = new Uint8Array(punti.length);
  tieni[0] = 1;
  tieni[punti.length - 1] = 1;
  const pila: Array<[number, number]> = [[0, punti.length - 1]];
  const quadrata = tolleranza * tolleranza;
  while (pila.length > 0) {
    const [inizio, fine] = pila.pop()!;
    const [ax, ay] = punti[inizio]!;
    const [bx, by] = punti[fine]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lunghezza = dx * dx + dy * dy;
    let massima = -1;
    let dove = -1;
    for (let corrente = inizio + 1; corrente < fine; corrente += 1) {
      const [px, py] = punti[corrente]!;
      let distanza: number;
      if (lunghezza === 0) {
        distanza = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lunghezza));
        distanza = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (distanza > massima) {
        massima = distanza;
        dove = corrente;
      }
    }
    if (dove > 0 && massima > quadrata) {
      tieni[dove] = 1;
      pila.push([inizio, dove], [dove, fine]);
    }
  }
  return punti.filter((_punto, indice) => tieni[indice] === 1);
}

/**
 * Il percorso sfoltito: ogni catena di `L` dopo un punto diventa la polilinea minima entro `tolleranza` (mm del
 * disegno); archi, chiusure e percorsi che non si sanno leggere restano esatti.
 * @param percorso - Il `d` di un percorso SVG.
 * @param tolleranza - Lo scarto massimo ammesso, nelle unità del disegno.
 * @returns Il percorso sfoltito.
 * @public
 */
export function sfoltisciPercorso(percorso: string, tolleranza: number): string {
  const comandi = leggi(percorso);
  if (!comandi || !(tolleranza > 0)) {
    return percorso;
  }
  const parti: string[] = [];
  // The polyline being drawn from the pen's position: it always starts with a move to its first point (a move to where
  // the pen already is changes nothing in a stroke).
  let catena: Punto[] = [];
  const chiudiCatena = (): void => {
    if (catena.length > 0) {
      const [primo, ...resto] = sfoltisci(catena, tolleranza);
      parti.push(`M${numero(primo![0])} ${numero(primo![1])}`, ...resto.map(([x, y]) => `L${numero(x)} ${numero(y)}`));
    }
    catena = [];
  };
  for (const comando of comandi) {
    switch (comando.tipo) {
      case 'M': {
        chiudiCatena();
        catena = [comando.punto!];
        break;
      }
      case 'L': {
        catena.push(comando.punto!);
        break;
      }
      case 'A': {
        chiudiCatena();
        const [rx, ry, rotazione, grande, verso, x, y] = comando.numeri as [
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        parti.push(
          `A${numero(rx)} ${numero(ry)} ${numero(rotazione)} ${String(grande)} ${String(verso)} ${numero(x)} ${numero(y)}`,
        );
        // The pen ends on the arc's end: a line that follows starts there.
        catena = [[x, y]];
        break;
      }
      default: {
        chiudiCatena();
        parti.push('Z');
      }
    }
  }
  chiudiCatena();
  return parti.join(' ');
}

/**
 * Il percorso spezzato in pezzi di al più `massimo` caratteri, ciascuno che comincia con un `M`: chi lo disegna non deve
 * reggere un percorso da milioni di caratteri in una volta. Un tratto senza `M` proprio resta col suo inizio.
 * @param percorso - Il `d` di un percorso SVG.
 * @param massimo - Caratteri al più per pezzo (predefinito 6000).
 * @returns I pezzi.
 * @public
 */
export function spezzaPercorso(percorso: string, massimo = 6000): string[] {
  const tratti = percorso.split(/(?=M)/u).filter((tratto) => tratto.trim().length > 0);
  const pezzi: string[] = [];
  let corrente = '';
  for (const tratto of tratti) {
    if (corrente && corrente.length + tratto.length > massimo) {
      pezzi.push(corrente.trim());
      corrente = '';
    }
    corrente += tratto;
  }
  if (corrente.trim()) {
    pezzi.push(corrente.trim());
  }
  return pezzi;
}
