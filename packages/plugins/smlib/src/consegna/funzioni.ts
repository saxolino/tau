import type * as Smlib from '@classcad/smlibwasm';
import { decodificaNomeStep } from '#producibilita/funzioni.js';
import { sfoltisciPercorso } from '#consegna/percorsi.js';
import type {
  DaCorreggere,
  EsitoDxf,
  EsitoRilettura,
  EsitoStep,
  EsitoTavola,
  Ingombro,
  ModoDxf,
  PezzoConsegna,
  PezzoRiletto,
  RichiestaDxf,
  RichiestaRilettura,
  RichiestaStep,
  RichiestaTavola,
  VistaTavola,
} from '#consegna/tipi.js';

/**
 * Le funzioni del worker della consegna (E3a), sopra SMLib soltanto (Apache 2.0): nessun OpenCASCADE.
 *
 * - **STEP**: legge lo STEP del kernel del progetto, controlla nomi, solidi, validità e volume di ogni pezzo contro le
 *   Misure, lo riscrive con un prodotto per pezzo (nome del pezzo e materiale nel nome del prodotto, colore del
 *   materiale) e rilegge i byte scritti: si consegnano solo byte riletti con gli stessi volumi e un solido per pezzo.
 * - **IGES**: SMLib 0.5 lo legge soltanto; la conversione resta a OpenCASCADE (l'unico pezzo LGPL che resta), il
 *   controllo è la rilettura qui, con lo stesso confronto di volumi e solidi.
 * - **DXF**: il contorno in vera grandezza dei pezzi piani (placche, fibbie, piante), le tre viste per gli altri.
 * - **Tavola**: le viste ortogonali (primo diedro) con le linee nascoste e l'isometrica, per la tavola PDF.
 */

type Lib = typeof Smlib;
type Corpo = Smlib.Part | Smlib.Shell;

/**
 * Scarto relativo ammesso fra il volume del kernel e quello riletto da un file esatto (0,1 %).
 * @public
 */
export const tolleranzaVolumeModello = 1e-3;
/**
 * Scarto relativo ammesso fra il volume scritto e quello riletto dallo stesso file.
 * @public
 */
export const tolleranzaVolumeFile = 1e-6;
/**
 * Un pezzo è piano quando il suo spessore (Z) non supera questa frazione del lato minore in pianta.
 * @public
 */
export const rapportoPiano = 0.25;

const daCorreggere = (problema: DaCorreggere['problema'], pezzi?: readonly string[]): DaCorreggere =>
  pezzi && pezzi.length > 0 ? { stato: 'da_correggere', problema, pezzi } : { stato: 'da_correggere', problema };

/**
 * Il nome del prodotto STEP di un pezzo: il pezzo, e il materiale quando è noto («Telaio fibbia · Ottone»).
 * @param pezzo - Il pezzo.
 * @returns Il nome del prodotto.
 * @public
 */
export const nomeProdotto = (pezzo: PezzoConsegna): string =>
  pezzo.materiale ? `${pezzo.nome} · ${pezzo.materiale.nome}` : pezzo.nome;

const leggiCorpi = (lib: Lib, letti: Smlib.Shape | Smlib.ShapeList<Corpo>): Corpo[] =>
  (letti instanceof lib.Shape ? [letti] : [...letti]) as Corpo[];

const corpiStep = (lib: Lib, step: Uint8Array<ArrayBuffer>): Corpo[] =>
  leggiCorpi(lib, lib.fromStep(step, { heal: false }) as Smlib.Shape | Smlib.ShapeList<Corpo>);

const ingombroDi = (corpo: Corpo): Ingombro => {
  const { min, max } = corpo.bbox();
  return [max.x - min.x, max.y - min.y, max.z - min.z];
};

/**
 * L'ingombro di più corpi insieme, nelle loro posizioni.
 * @param corpi - I corpi.
 * @returns Lati X, Y, Z (mm).
 */
const ingombroUnione = (corpi: readonly Corpo[]): Ingombro => {
  const riquadri = corpi.map((corpo) => corpo.bbox());
  const lato = (asse: 'x' | 'y' | 'z'): number =>
    Math.max(...riquadri.map(({ max }) => max[asse])) - Math.min(...riquadri.map(({ min }) => min[asse]));
  return [lato('x'), lato('y'), lato('z')];
};

const volumeDi = (lib: Lib, corpo: Corpo): number => (corpo instanceof lib.Part ? corpo.volume : 0);

const solidiDi = (lib: Lib, corpo: Corpo): number => (corpo instanceof lib.Part ? corpo.solids().length : 0);

/**
 * Valid as a supplier's CAD needs it: closed, manifold, a positive volume, and (`strict`) every face, edge and vertex
 * within its tolerances, as the kernel's own `check` sees them: an edge far from its faces is refused here too.
 * @param lib - Libreria SMLib.
 * @param corpo - Il corpo riletto.
 * @returns Vero per un solido valido.
 */
const valido = (lib: Lib, corpo: Corpo): boolean => {
  try {
    return corpo instanceof lib.Part && corpo.isValid({ strict: true });
  } catch {
    return false;
  }
};

const stessoVolume = (letto: number, atteso: number, tolleranza: number): boolean =>
  Number.isFinite(letto) && Math.abs(letto - atteso) <= Math.max(1e-6, Math.abs(atteso) * tolleranza);

type Scelta = Readonly<{ pezzi: readonly PezzoConsegna[]; selezionati?: readonly string[] }>;

/**
 * I nomi del modello che il file non ha una volta sola, poi quelli del file che il modello non ha.
 * @param letti - I nomi nel file.
 * @param attesi - I nomi del modello.
 * @returns I nomi diversi, senza doppi.
 */
const nomiDiversi = (letti: readonly string[], attesi: readonly string[]): string[] => {
  const conta = (nomi: readonly string[], nome: string): number => nomi.filter((altro) => altro === nome).length;
  const delModello = new Set(attesi);
  return [
    ...new Set([
      ...attesi.filter((nome) => conta(letti, nome) !== 1 || conta(attesi, nome) !== 1),
      ...letti.filter((nome) => !delModello.has(nome)),
    ]),
  ];
};

/**
 * I pezzi scelti, nell'ordine del modello; undefined se la scelta non è un sottoinsieme non vuoto e senza doppi.
 * @param pezzi - I pezzi del modello.
 * @param selezionati - I nomi scelti (assente = tutti).
 * @returns I pezzi scelti, o `undefined`.
 */
const pezziScelti = (
  pezzi: readonly PezzoConsegna[],
  selezionati: readonly string[] | undefined,
): PezzoConsegna[] | undefined => {
  if (selezionati === undefined) {
    return [...pezzi];
  }
  const nomi = new Set(pezzi.map(({ nome }) => nome));
  const scelti = new Set(selezionati);
  if (selezionati.length === 0 || scelti.size !== selezionati.length || selezionati.some((nome) => !nomi.has(nome))) {
    return undefined;
  }
  return pezzi.filter(({ nome }) => scelti.has(nome));
};

const riletto = (
  lib: Lib,
  corpo: Corpo,
  { nome, prodotto }: Readonly<{ nome: string; prodotto: string }>,
): PezzoRiletto => ({
  nome,
  prodotto,
  solidi: solidiDi(lib, corpo),
  volumeMm3: volumeDi(lib, corpo),
  valido: valido(lib, corpo),
  ingombro: ingombroDi(corpo),
});

/**
 * I corpi dello STEP del kernel per nome, controllati contro i pezzi del modello: un corpo per nome, un solido
 * valido ciascuno, e il volume delle Misure quando il pezzo lo porta.
 * @param lib - Libreria SMLib.
 * @param step - Lo STEP del kernel.
 * @param scelta - I pezzi del modello e quelli scelti.
 * @returns Le coppie pezzo–corpo scelte, o il problema.
 */
function corpiControllati(
  lib: Lib,
  step: Uint8Array<ArrayBuffer>,
  { pezzi, selezionati }: Scelta,
): { scelti: Array<{ pezzo: PezzoConsegna; corpo: Corpo }> } | DaCorreggere {
  let corpi: Corpo[];
  try {
    corpi = corpiStep(lib, step);
  } catch {
    return daCorreggere('read');
  }
  const nomi = corpi.map((corpo) => decodificaNomeStep(corpo.name ?? ''));
  const attesi = pezzi.map(({ nome }) => nome);
  // A piece of two separate solids comes back as two bodies under its name: that is a solids problem, not a name one.
  const doppi = attesi.filter((nome) => nomi.filter((letto) => letto === nome).length > 1);
  if (doppi.length > 0 && new Set(attesi).size === attesi.length) {
    return daCorreggere('solids', doppi);
  }
  const diversi = nomiDiversi(nomi, attesi);
  if (attesi.length === 0 || diversi.length > 0) {
    return daCorreggere('names', diversi);
  }
  const scelti = pezziScelti(pezzi, selezionati);
  if (!scelti) {
    return daCorreggere('selection');
  }
  const coppie = scelti.map((pezzo) => ({ pezzo, corpo: corpi[nomi.indexOf(pezzo.nome)]! }));
  const nonChiusi = coppie.filter(({ corpo }) => !(corpo instanceof lib.Part)).map(({ pezzo }) => pezzo.nome);
  if (nonChiusi.length > 0) {
    return daCorreggere('invalid', nonChiusi);
  }
  if (coppie.some(({ corpo }) => solidiDi(lib, corpo) !== 1)) {
    return daCorreggere(
      'solids',
      coppie.filter(({ corpo }) => solidiDi(lib, corpo) !== 1).map(({ pezzo }) => pezzo.nome),
    );
  }
  const nonValidi = coppie.filter(({ corpo }) => !valido(lib, corpo)).map(({ pezzo }) => pezzo.nome);
  if (nonValidi.length > 0) {
    return daCorreggere('invalid', nonValidi);
  }
  const fuoriMisura = coppie
    .filter(
      ({ pezzo, corpo }) =>
        pezzo.volumeMm3 !== undefined && !stessoVolume(volumeDi(lib, corpo), pezzo.volumeMm3, tolleranzaVolumeModello),
    )
    .map(({ pezzo }) => pezzo.nome);
  if (fuoriMisura.length > 0) {
    return daCorreggere('volume', fuoriMisura);
  }
  return { scelti: coppie };
}

/**
 * Lo STEP da consegnare: controlla lo STEP del kernel, lo riscrive (un prodotto per pezzo, col materiale) e rilegge i
 * byte scritti. Non lancia: ogni passo che fallisce è un esito «da correggere».
 * @param lib - Libreria SMLib.
 * @param richiesta - STEP del kernel, pezzi, scelta, nome del progetto.
 * @returns Lo STEP riletto, o il problema.
 * @public
 */
export function preparaStep(lib: Lib, richiesta: RichiestaStep): EsitoStep {
  const controllati = corpiControllati(lib, richiesta.step, richiesta);
  if ('stato' in controllati) {
    return controllati;
  }
  const { scelti } = controllati;
  let testo: string;
  try {
    const corpi = scelti.map(({ pezzo, corpo }) => {
      const conNome = corpo.named(nomeProdotto(pezzo));
      return pezzo.materiale ? conNome.colored(pezzo.materiale.colore) : conNome;
    });
    testo = lib.toStep(corpi, { name: richiesta.progetto.trim() || 'SinopiaCAD', unit: 'mm', assembly: true });
  } catch {
    return daCorreggere('write');
  }
  const byte = new TextEncoder().encode(testo);
  // La prova: i byte che si consegnano, riletti, danno gli stessi pezzi con gli stessi volumi.
  let corpi: Corpo[];
  try {
    corpi = corpiStep(lib, byte);
  } catch {
    return daCorreggere('read');
  }
  const prodotti = corpi.map((corpo) => decodificaNomeStep(corpo.name ?? ''));
  const attesi = scelti.map(({ pezzo }) => nomeProdotto(pezzo));
  const diversi = nomiDiversi(prodotti, attesi);
  if (diversi.length > 0) {
    return daCorreggere(
      'names',
      scelti.filter(({ pezzo }) => diversi.includes(nomeProdotto(pezzo))).map(({ pezzo }) => pezzo.nome),
    );
  }
  const pezzi = scelti.map(({ pezzo }) => {
    const prodotto = nomeProdotto(pezzo);
    return riletto(lib, corpi[prodotti.indexOf(prodotto)]!, { nome: pezzo.nome, prodotto });
  });
  const cambiati = pezzi
    .filter(
      (pezzo, indice) =>
        pezzo.solidi !== 1 ||
        !pezzo.valido ||
        !stessoVolume(pezzo.volumeMm3, volumeDi(lib, scelti[indice]!.corpo), tolleranzaVolumeFile),
    )
    .map(({ nome }) => nome);
  if (cambiati.length > 0) {
    return daCorreggere(pezzi.some(({ solidi }) => solidi !== 1) ? 'solids' : 'volume', cambiati);
  }
  return { stato: 'verificato', step: byte, pezzi, ingombro: ingombroUnione(corpi) };
}

/**
 * Rilegge un file scritto da un altro motore (IGES) e lo confronta con i pezzi attesi: tanti corpi quanti pezzi, un
 * solido valido ciascuno, gli stessi volumi (accoppiati per volume: i nomi IGES non sono affidabili fra i motori).
 * @param lib - Libreria SMLib.
 * @param richiesta - Il file e i pezzi attesi.
 * @returns I pezzi riletti, o il problema.
 * @public
 */
export function rileggi(lib: Lib, richiesta: RichiestaRilettura): EsitoRilettura {
  let corpi: Corpo[];
  try {
    corpi = leggiCorpi(lib, lib.fromIges(richiesta.file, { heal: false }) as Smlib.Shape | Smlib.ShapeList<Corpo>);
  } catch {
    return daCorreggere('read');
  }
  const attesi = [...richiesta.attesi].sort((a, b) => a.volumeMm3 - b.volumeMm3);
  if (corpi.length !== attesi.length) {
    return daCorreggere(
      'solids',
      attesi.map(({ nome }) => nome),
    );
  }
  const letti = corpi.map((corpo) => ({ corpo, volume: volumeDi(lib, corpo) })).sort((a, b) => a.volume - b.volume);
  const pezzi = letti.map(({ corpo }, indice) => {
    const { nome } = attesi[indice]!;
    return riletto(lib, corpo, { nome, prodotto: decodificaNomeStep(corpo.name ?? '') || nome });
  });
  const diversi = pezzi
    .filter(
      (pezzo, indice) =>
        pezzo.solidi !== 1 || !stessoVolume(pezzo.volumeMm3, attesi[indice]!.volumeMm3, tolleranzaVolumeModello),
    )
    .map(({ nome }) => nome);
  if (diversi.length > 0) {
    return daCorreggere(pezzi.some(({ solidi }) => solidi !== 1) ? 'solids' : 'volume', diversi);
  }
  return { stato: 'verificato', pezzi };
}

/**
 * Se un pezzo è piano: dichiarato dal processo, o con lo spessore (Z) entro un quarto del lato minore in pianta.
 * @param ingombro - Ingombro del pezzo.
 * @param dichiarato - Piano per il processo (tranciatura, taglio del cuoio).
 * @returns Vero per un pezzo piano.
 * @public
 */
export const pezzoPiano = (ingombro: Ingombro, dichiarato = false): boolean =>
  dichiarato || (ingombro[2] > 0 && ingombro[2] <= rapportoPiano * Math.min(ingombro[0], ingombro[1]));

const entitaDxf = (dxf: string): number =>
  dxf.match(/\n(?:LINE|ARC|CIRCLE|SPLINE|ELLIPSE|LWPOLYLINE)\r?\n/gu)?.length ?? 0;

/**
 * Il DXF per la fabbrica: il contorno in vera grandezza (vista dall'alto, coordinate del modello) quando ogni pezzo
 * scelto è piano, altrimenti le tre viste con le linee nascoste tratteggiate. Riletto: il contorno deve dare almeno una
 * catena chiusa per pezzo.
 * @param lib - Libreria SMLib.
 * @param richiesta - STEP del kernel, pezzi, scelta e modo.
 * @returns Il DXF riletto, o il problema.
 * @public
 */
export function preparaDxf(lib: Lib, richiesta: RichiestaDxf): EsitoDxf {
  // Lo STEP del kernel: i nomi dei corpi sono quelli dei pezzi.
  const controllati = corpiControllati(lib, richiesta.step, richiesta);
  if ('stato' in controllati) {
    return controllati;
  }
  const { scelti } = controllati;
  const modo: ModoDxf =
    richiesta.modo ??
    (scelti.every(({ pezzo, corpo }) => pezzoPiano(ingombroDi(corpo), pezzo.piano)) ? 'contorno' : 'viste');
  let dxf: string;
  try {
    dxf =
      modo === 'contorno'
        ? lib.toDxf(
            scelti.flatMap(({ corpo }) => [...corpo.outline(lib.Plane.XY)]),
            { plane: lib.Plane.XY },
          )
        : lib.toDxf(
            lib.drawingViews(
              scelti.map(({ corpo }) => corpo),
              ['front', 'top', 'left'],
              { projection: 'first-angle', hidden: true },
            ),
          );
  } catch {
    return daCorreggere('write');
  }
  let contorni: number;
  try {
    contorni = [...lib.fromDxfWires(dxf)].filter((catena) => catena.isClosed).length;
  } catch {
    return daCorreggere('read');
  }
  const entita = entitaDxf(dxf);
  if (entita === 0 || (modo === 'contorno' && contorni < scelti.length)) {
    return daCorreggere(
      'invalid',
      scelti.map(({ pezzo }) => pezzo.nome),
    );
  }
  return { stato: 'verificato', dxf, modo, contorni, entita };
}

/** Rotazione che porta la direzione (1, −1, 1) sulla vista di fronte: l'isometrica vista da destra, davanti, alto. */
const angoloIsometrico = (Math.atan(1 / Math.SQRT2) * 180) / Math.PI;

const percorso = (svg: string, classe: 'visible' | 'hidden'): string => {
  for (const tag of svg.match(/<path\b[^>]*>/gu) ?? []) {
    if (new RegExp(`class="${classe}"`, 'u').test(tag)) {
      return /\bd="([^"]*)"/u.exec(tag)?.[1] ?? '';
    }
  }
  return '';
};

const vistaTavola = (lib: Lib, vista: Smlib.DrawingView, nome: VistaTavola['nome']): VistaTavola => {
  const svg = lib.toSvg([vista]);
  const { min, max } = vista.bbox();
  // Curves other than lines and circular arcs come as dense polylines: thinned to 1/2500 of the view, invisible in print.
  const tolleranza = Math.max(max.x - min.x, max.y - min.y) / 2500;
  return {
    nome,
    visibili: sfoltisciPercorso(percorso(svg, 'visible'), tolleranza),
    nascoste: sfoltisciPercorso(percorso(svg, 'hidden'), tolleranza),
    // L'SVG ha la y verso il basso: il riquadro si legge così.
    riquadro: { x: min.x, y: -max.y, larghezza: max.x - min.x, altezza: max.y - min.y },
  };
};

/**
 * I disegni della tavola: fronte, lato sinistro e alto in primo diedro (ISO) con le linee nascoste, e l'isometrica
 * senza; l'ingombro di tutto e di ogni pezzo.
 * @param lib - Libreria SMLib.
 * @param richiesta - STEP del kernel e pezzi scelti.
 * @returns Le viste, o il problema.
 * @public
 */
export function disegniTavola(lib: Lib, richiesta: RichiestaTavola): EsitoTavola {
  let corpi: Corpo[];
  try {
    corpi = corpiStep(lib, richiesta.step);
  } catch {
    return daCorreggere('read');
  }
  const tutti = corpi.map((corpo) => ({ corpo, nome: decodificaNomeStep(corpo.name ?? '') }));
  const { selezionati } = richiesta;
  const coppie = selezionati ? tutti.filter(({ nome }) => selezionati.includes(nome)) : tutti;
  const scelti = coppie.map(({ corpo }) => corpo);
  if (scelti.length === 0 || (selezionati && scelti.length !== selezionati.length)) {
    return daCorreggere('selection');
  }
  try {
    const ortogonali = lib.drawingViews(scelti, ['front', 'left', 'top'], { projection: 'first-angle', hidden: true });
    const ruotati = scelti.map((corpo) => corpo.rotate(lib.Axis.Z, -45).rotate(lib.Axis.X, angoloIsometrico));
    const [iso] = lib.drawingViews(ruotati, ['front'], { hidden: false });
    const viste = [
      ...ortogonali.map((vista) => vistaTavola(lib, vista, vista.name as VistaTavola['nome'])),
      ...(iso ? [vistaTavola(lib, iso, 'iso')] : []),
    ];
    return {
      stato: 'pronto',
      viste,
      ingombro: ingombroUnione(scelti),
      pezzi: coppie.map(({ corpo, nome }) => ({ nome, ingombro: ingombroDi(corpo), volumeMm3: volumeDi(lib, corpo) })),
    };
  } catch {
    return daCorreggere('write');
  }
}

/**
 * Le funzioni del worker sopra una libreria data (quella del worker; nei test quella del processo).
 * @param lib - Libreria SMLib.
 * @returns `{ step, rileggi, dxf, tavola }`.
 * @public
 */
export function funzioniConsegna(lib: Lib): {
  step: (richiesta: RichiestaStep) => EsitoStep;
  rileggi: (richiesta: RichiestaRilettura) => EsitoRilettura;
  dxf: (richiesta: RichiestaDxf) => EsitoDxf;
  tavola: (richiesta: RichiestaTavola) => EsitoTavola;
} {
  return {
    step: (richiesta) => preparaStep(lib, richiesta),
    rileggi: (richiesta) => rileggi(lib, richiesta),
    dxf: (richiesta) => preparaDxf(lib, richiesta),
    tavola: (richiesta) => disegniTavola(lib, richiesta),
  };
}
