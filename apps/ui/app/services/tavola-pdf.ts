import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { spezzaPercorso } from '@taucad/smlib/consegna';
import type { Ingombro, VistaTavola } from '@taucad/smlib/consegna';

/**
 * La tavola tecnica di SinopiaCAD (E3a): un foglio A4 orizzontale per il laboratorio o il fornitore, con le viste
 * ortogonali in primo diedro (fronte, lato sinistro, alto) e le linee nascoste tratteggiate, l'isometrica, le quote
 * d'ingombro, materiale, processo e peso di ogni pezzo, gli esiti di producibilità e il cartiglio.
 *
 * Le linee sono quelle dei disegni 2D di SMLib 0.5 (`drawingViews`, esatte per rette e archi), scritte con pdf-lib
 * (MIT) e i caratteri standard del PDF: nessun font da scaricare, nessun servizio. Quello che non sta nel foglio
 * continua su un secondo foglio di note.
 */

/** Un millimetro in punti PDF. */
const mm = 72 / 25.4;
/** A4 orizzontale, in mm. */
const foglio = { larghezza: 297, altezza: 210 } as const;
const margine = 10;
/** Scale normalizzate (UNI EN ISO 5455): ingrandimento per i gioielli, riduzione per i fondi. */
const scaleNormali = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02] as const;

/** Le parole della tavola, nella lingua dell'interfaccia. */
export type TestiTavola = Readonly<{
  titolo: string;
  progetto: string;
  pezzi: string;
  versione: string;
  data: string;
  scala: string;
  unita: string;
  proiezione: string;
  foglio: string;
  fronte: string;
  lato: string;
  alto: string;
  isometrica: string;
  nonInScala: string;
  colonnaPezzo: string;
  colonnaMateriale: string;
  colonnaProcesso: string;
  colonnaPeso: string;
  pesoTotale: string;
  misure: string;
  producibilita: string;
  nessunControllo: string;
  livelli: Readonly<Record<'blocco' | 'avviso' | 'ok' | 'info', string>>;
  note: string;
  segue: string;
}>;

/** Un pezzo come lo descrive la tavola. */
export type PezzoTavola = Readonly<{
  nome: string;
  materiale?: string;
  processo?: string;
  pesoGrammi?: number;
}>;

/** I dati della tavola. */
export type DatiTavola = Readonly<{
  progetto: string;
  /** I pezzi disegnati («Tutti i pezzi» o il nome del pezzo scelto). */
  selezione: string;
  versione: string;
  data: Date;
  lingua: 'it' | 'en';
  viste: readonly VistaTavola[];
  ingombro: Ingombro;
  pezzi: readonly PezzoTavola[];
  /** Le quote principali dalle Misure, una riga per voce. */
  misure: readonly string[];
  controlli: ReadonlyArray<Readonly<{ livello: 'blocco' | 'avviso' | 'ok' | 'info'; testo: string }>>;
  testi: TestiTavola;
}>;

/** La scala scelta per le viste ortogonali, e come si scrive («5:1», «1:2»). */
export function scalaTavola(ingombro: Ingombro, spazio: Readonly<{ larghezza: number; altezza: number }>): number {
  const [x, y, z] = ingombro.map((valore) => Math.max(valore, 1e-3)) as [number, number, number];
  const massima = Math.min(spazio.larghezza / x, spazio.altezza / z, spazio.larghezza / y, spazio.altezza / y);
  return scaleNormali.find((scala) => scala <= massima) ?? scaleNormali.at(-1)!;
}

/** Una scala come si scrive in cartiglio. */
export const scritturaScala = (scala: number): string =>
  scala >= 1 ? `${String(scala)}:1` : `1:${String(Math.round(1 / scala))}`;

const numero = (valore: number, lingua: 'it' | 'en', cifre = 2): string =>
  new Intl.NumberFormat(lingua === 'it' ? 'it-IT' : 'en-GB', { maximumFractionDigits: cifre }).format(valore);

const data = (quando: Date, lingua: 'it' | 'en'): string =>
  new Intl.DateTimeFormat(lingua === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(quando);

/** Caratteri che i font standard (WinAnsi) non hanno, con il loro equivalente. */
const sostituzioni: Readonly<Record<string, string>> = {
  '⌀': 'Ø',
  '≥': '>=',
  '≤': '<=',
  '→': '->',
  '←': '<-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
};

/** Il testo scrivibile con il font: le sostituzioni note, poi «?» per ciò che il font non ha. */
function scrivibile(font: PDFFont, testo: string): string {
  let risultato = '';
  for (const carattere of testo) {
    const candidato = sostituzioni[carattere] ?? carattere;
    try {
      font.encodeText(candidato);
      risultato += candidato;
    } catch {
      risultato += '?';
    }
  }
  return risultato;
}

type Penna = Readonly<{ regolare: PDFFont; grassetto: PDFFont }>;

const nero = rgb(0.1, 0.09, 0.08);
const grigio = rgb(0.45, 0.43, 0.4);
const chiaro = rgb(0.75, 0.73, 0.7);

/** Scrive una riga in mm (origine in basso a sinistra), tagliandola con «…» se supera la larghezza. */
function riga(
  pagina: PDFPage,
  testo: string,
  opzioni: Readonly<{
    font: PDFFont;
    x: number;
    y: number;
    corpo: number;
    larghezza?: number;
    colore?: ReturnType<typeof rgb>;
  }>,
): void {
  const { font } = opzioni;
  let scritto = scrivibile(font, testo);
  if (opzioni.larghezza !== undefined) {
    const massimo = opzioni.larghezza * mm;
    if (font.widthOfTextAtSize(scritto, opzioni.corpo) > massimo) {
      while (scritto.length > 1 && font.widthOfTextAtSize(`${scritto}…`, opzioni.corpo) > massimo) {
        scritto = scritto.slice(0, -1);
      }
      scritto = `${scritto.trimEnd()}…`;
    }
  }
  pagina.drawText(scritto, {
    x: opzioni.x * mm,
    y: opzioni.y * mm,
    size: opzioni.corpo,
    font,
    color: opzioni.colore ?? nero,
  });
}

const linea = (
  pagina: PDFPage,
  [da, a]: readonly [readonly [number, number], readonly [number, number]],
  { spessore = 0.25, colore = nero }: Readonly<{ spessore?: number; colore?: ReturnType<typeof rgb> }> = {},
): void => {
  pagina.drawLine({
    start: { x: da[0] * mm, y: da[1] * mm },
    end: { x: a[0] * mm, y: a[1] * mm },
    thickness: spessore * mm,
    color: colore,
  });
};

const freccia = (pagina: PDFPage, punta: readonly [number, number], verso: readonly [number, number]): void => {
  const lunghezza = 2;
  const apertura = 0.6;
  const [dx, dy] = verso;
  const base: [number, number] = [punta[0] - dx * lunghezza, punta[1] - dy * lunghezza];
  const normale: [number, number] = [-dy * apertura, dx * apertura];
  pagina.drawSvgPath(
    `M ${punta[0] * mm} ${-punta[1] * mm} L ${(base[0] + normale[0]) * mm} ${-(base[1] + normale[1]) * mm} L ${(base[0] - normale[0]) * mm} ${-(base[1] - normale[1]) * mm} Z`,
    { x: 0, y: 0, color: nero },
  );
};

/** Una quota: linee di richiamo, linea di quota con le frecce, il valore al centro. */
function quota(
  pagina: PDFPage,
  {
    font,
    da,
    a,
    testo,
    orientamento,
  }: Readonly<{
    font: PDFFont;
    da: readonly [number, number];
    a: readonly [number, number];
    testo: string;
    orientamento: 'orizzontale' | 'verticale';
  }>,
): void {
  const scarto = 7;
  if (orientamento === 'orizzontale') {
    const y = Math.min(da[1], a[1]) - scarto;
    linea(
      pagina,
      [
        [da[0], da[1] - 1],
        [da[0], y - 1.5],
      ],
      { spessore: 0.13, colore: grigio },
    );
    linea(
      pagina,
      [
        [a[0], a[1] - 1],
        [a[0], y - 1.5],
      ],
      { spessore: 0.13, colore: grigio },
    );
    linea(
      pagina,
      [
        [da[0], y],
        [a[0], y],
      ],
      { spessore: 0.18 },
    );
    freccia(pagina, [da[0], y], [-1, 0]);
    freccia(pagina, [a[0], y], [1, 0]);
    const larghezza = font.widthOfTextAtSize(testo, 7) / mm;
    riga(pagina, testo, { font: font, x: (da[0] + a[0]) / 2 - larghezza / 2, y: y + 0.8, corpo: 7 });
    return;
  }
  const x = Math.min(da[0], a[0]) - scarto;
  linea(
    pagina,
    [
      [da[0] - 1, da[1]],
      [x - 1.5, da[1]],
    ],
    { spessore: 0.13, colore: grigio },
  );
  linea(
    pagina,
    [
      [a[0] - 1, a[1]],
      [x - 1.5, a[1]],
    ],
    { spessore: 0.13, colore: grigio },
  );
  linea(
    pagina,
    [
      [x, da[1]],
      [x, a[1]],
    ],
    { spessore: 0.18 },
  );
  freccia(pagina, [x, da[1]], [0, -1]);
  freccia(pagina, [x, a[1]], [0, 1]);
  const larghezza = font.widthOfTextAtSize(testo, 7) / mm;
  pagina.drawText(scrivibile(font, testo), {
    x: (x - 0.8) * mm,
    y: ((da[1] + a[1]) / 2 - larghezza / 2) * mm,
    size: 7,
    font,
    color: nero,
    rotate: degrees(90),
  });
}

/**
 * Disegna una vista centrata nel riquadro dato (mm), alla scala data; restituisce il rettangolo occupato (mm).
 * La vista è in coordinate SVG (mm, y verso il basso): `drawSvgPath` capovolge la y.
 */
function disegnaVista(
  pagina: PDFPage,
  vista: VistaTavola,
  { centro, scala }: Readonly<{ centro: readonly [number, number]; scala: number }>,
): { sinistra: number; destra: number; basso: number; alto: number } {
  const { riquadro } = vista;
  const x0 = centro[0] - (riquadro.x + riquadro.larghezza / 2) * scala;
  const y0 = centro[1] + (riquadro.y + riquadro.altezza / 2) * scala;
  const fattore = scala * mm;
  // In short pieces: pdf-lib builds each path's operators at once, and a long path overflows its stack.
  for (const pezzo of spezzaPercorso(vista.nascoste)) {
    pagina.drawSvgPath(pezzo, {
      x: x0 * mm,
      y: y0 * mm,
      scale: fattore,
      borderColor: grigio,
      borderWidth: 0.18 / scala,
      borderDashArray: [1.6 / scala, 0.9 / scala],
    });
  }
  for (const pezzo of spezzaPercorso(vista.visibili)) {
    pagina.drawSvgPath(pezzo, {
      x: x0 * mm,
      y: y0 * mm,
      scale: fattore,
      borderColor: nero,
      borderWidth: 0.35 / scala,
    });
  }
  const larghezza = riquadro.larghezza * scala;
  const altezza = riquadro.altezza * scala;
  return {
    sinistra: centro[0] - larghezza / 2,
    destra: centro[0] + larghezza / 2,
    basso: centro[1] - altezza / 2,
    alto: centro[1] + altezza / 2,
  };
}

/** Le righe che stanno in `altezza` (mm) a interlinea `passo`, e quelle che restano. */
const dividi = <T>(righe: readonly T[], altezza: number, passo: number): [T[], T[]] => {
  const quante = Math.max(0, Math.floor(altezza / passo));
  return [righe.slice(0, quante), righe.slice(quante)];
};

/**
 * Crea la tavola PDF.
 * @param dati - Progetto, viste, pezzi, misure, controlli e parole.
 * @returns I byte del PDF.
 */
export async function creaTavolaPdf(dati: DatiTavola): Promise<Uint8Array<ArrayBuffer>> {
  const documento = await PDFDocument.create();
  const penna: Penna = {
    regolare: await documento.embedFont(StandardFonts.Helvetica),
    grassetto: await documento.embedFont(StandardFonts.HelveticaBold),
  };
  const { testi, lingua } = dati;
  documento.setTitle(`${testi.titolo} — ${dati.progetto}`);
  documento.setAuthor('SinopiaCAD');
  documento.setCreator('SinopiaCAD');
  documento.setProducer('SinopiaCAD');
  documento.setSubject(dati.selezione);
  documento.setLanguage(lingua === 'it' ? 'it-IT' : 'en-GB');
  documento.setCreationDate(dati.data);
  const pagina = documento.addPage([foglio.larghezza * mm, foglio.altezza * mm]);
  const destra = foglio.larghezza - margine;
  const alto = foglio.altezza - margine;
  // La cornice e le divisioni: a sinistra la griglia delle viste, a destra isometrica, pezzi e cartiglio.
  pagina.drawRectangle({
    x: margine * mm,
    y: margine * mm,
    width: (destra - margine) * mm,
    height: (alto - margine) * mm,
    borderColor: nero,
    borderWidth: 0.5 * mm,
  });
  const colonna = destra - 92;
  const centroGriglia = [(margine + colonna) / 2, (margine + alto) / 2] as const;
  linea(
    pagina,
    [
      [colonna, margine],
      [colonna, alto],
    ],
    { spessore: 0.35 },
  );
  linea(
    pagina,
    [
      [centroGriglia[0], margine],
      [centroGriglia[0], alto],
    ],
    { spessore: 0.13, colore: chiaro },
  );
  linea(
    pagina,
    [
      [margine, centroGriglia[1]],
      [colonna, centroGriglia[1]],
    ],
    { spessore: 0.13, colore: chiaro },
  );
  const cartiglio = margine + 44;
  const iso = alto - 76;
  linea(
    pagina,
    [
      [colonna, cartiglio],
      [destra, cartiglio],
    ],
    { spessore: 0.35 },
  );
  linea(
    pagina,
    [
      [colonna, iso],
      [destra, iso],
    ],
    { spessore: 0.13, colore: chiaro },
  );

  // Le viste ortogonali, alla stessa scala normalizzata: fronte in alto a sinistra, il lato sinistro alla sua destra
  // e l'alto sotto (primo diedro, ISO).
  const cella = { larghezza: centroGriglia[0] - margine - 26, altezza: alto - centroGriglia[1] - 26 };
  const scala = scalaTavola(dati.ingombro, cella);
  const vista = (nome: VistaTavola['nome']): VistaTavola | undefined => dati.viste.find((v) => v.nome === nome);
  const [x, y, z] = dati.ingombro;
  const centri = {
    front: [(margine + centroGriglia[0]) / 2 + 4, (centroGriglia[1] + alto) / 2 + 2],
    left: [(centroGriglia[0] + colonna) / 2 + 4, (centroGriglia[1] + alto) / 2 + 2],
    top: [(margine + centroGriglia[0]) / 2 + 4, (margine + centroGriglia[1]) / 2 + 2],
  } as const;
  const etichette = { front: testi.fronte, left: testi.lato, top: testi.alto } as const;
  for (const nome of ['front', 'left', 'top'] as const) {
    const disegno = vista(nome);
    const cellaSinistra = nome === 'left' ? centroGriglia[0] : margine;
    const cellaAlta = nome === 'top' ? centroGriglia[1] : alto;
    riga(pagina, etichette[nome], {
      font: penna.grassetto,
      x: cellaSinistra + 3,
      y: cellaAlta - 5,
      corpo: 7,
      colore: grigio,
    });
    if (!disegno) {
      continue;
    }
    const occupato = disegnaVista(pagina, disegno, { centro: centri[nome], scala: scala });
    const orizzontale = nome === 'left' ? y : x;
    const verticale = nome === 'top' ? y : z;
    quota(pagina, {
      font: penna.regolare,
      da: [occupato.sinistra, occupato.basso],
      a: [occupato.destra, occupato.basso],
      testo: numero(orizzontale, lingua),
      orientamento: 'orizzontale',
    });
    quota(pagina, {
      font: penna.regolare,
      da: [occupato.sinistra, occupato.basso],
      a: [occupato.sinistra, occupato.alto],
      testo: numero(verticale, lingua),
      orientamento: 'verticale',
    });
  }

  // L'isometrica, scalata per stare nel suo riquadro: non è in scala.
  riga(pagina, `${testi.isometrica} · ${testi.nonInScala}`, {
    font: penna.grassetto,
    x: colonna + 3,
    y: alto - 5,
    corpo: 7,
    colore: grigio,
  });
  const isometrica = vista('iso');
  if (isometrica) {
    const spazio = { larghezza: 80, altezza: 60 };
    const fattore = Math.min(
      spazio.larghezza / Math.max(isometrica.riquadro.larghezza, 1e-3),
      spazio.altezza / Math.max(isometrica.riquadro.altezza, 1e-3),
    );
    disegnaVista(pagina, isometrica, { centro: [colonna + 46, iso + 36], scala: fattore });
  }

  // Le quote principali dalle Misure, nella quarta cella della griglia.
  const passo = 4.2;
  riga(pagina, testi.misure, {
    font: penna.grassetto,
    x: centroGriglia[0] + 3,
    y: centroGriglia[1] - 5,
    corpo: 7,
    colore: grigio,
  });
  const [misureQui, misureDopo] = dividi(dati.misure, centroGriglia[1] - margine - 14, passo);
  for (const [indice, testo] of misureQui.entries()) {
    riga(pagina, testo, {
      font: penna.regolare,
      x: centroGriglia[0] + 3,
      y: centroGriglia[1] - 11 - indice * passo,
      corpo: 7.5,
      larghezza: colonna - centroGriglia[0] - 6,
    });
  }

  // Pezzi (materiale, processo, peso) e producibilità, fra isometrica e cartiglio.
  let cursore = iso - 6;
  const colonne = [colonna + 3, colonna + 30, colonna + 54, colonna + 78] as const;
  for (const [indice, testo] of [
    testi.colonnaPezzo,
    testi.colonnaMateriale,
    testi.colonnaProcesso,
    testi.colonnaPeso,
  ].entries()) {
    riga(pagina, testo, { font: penna.grassetto, x: colonne[indice]!, y: cursore, corpo: 6.5, colore: grigio });
  }
  cursore -= 4;
  const spazioPezzi = 6;
  const [pezziQui, pezziDopo] = dividi(dati.pezzi, spazioPezzi * 4, 4);
  for (const pezzo of pezziQui) {
    const peso = pezzo.pesoGrammi === undefined ? '—' : `${numero(pezzo.pesoGrammi, lingua, 1)} g`;
    riga(pagina, pezzo.nome, { font: penna.regolare, x: colonne[0], y: cursore, corpo: 7, larghezza: 26 });
    riga(pagina, pezzo.materiale ?? '—', { font: penna.regolare, x: colonne[1], y: cursore, corpo: 7, larghezza: 23 });
    riga(pagina, pezzo.processo ?? '—', { font: penna.regolare, x: colonne[2], y: cursore, corpo: 7, larghezza: 23 });
    riga(pagina, peso, { font: penna.regolare, x: colonne[3], y: cursore, corpo: 7, larghezza: 11 });
    cursore -= 4;
  }
  const pesi = dati.pezzi.map(({ pesoGrammi }) => pesoGrammi);
  if (pesi.length > 0 && pesi.every((peso) => peso !== undefined)) {
    const totale = pesi.reduce<number>((somma, peso) => somma + peso, 0);
    riga(pagina, `${testi.pesoTotale}: ${numero(totale, lingua, 1)} g`, {
      font: penna.grassetto,
      x: colonne[0],
      y: cursore,
      corpo: 7,
    });
    cursore -= 4;
  }
  cursore -= 2;
  riga(pagina, testi.producibilita, { font: penna.grassetto, x: colonne[0], y: cursore, corpo: 6.5, colore: grigio });
  cursore -= 4;
  const controlli =
    dati.controlli.length > 0
      ? dati.controlli.map(({ livello, testo }) => `${testi.livelli[livello]} · ${testo}`)
      : [testi.nessunControllo];
  const [controlliQui, controlliDopo] = dividi(controlli, cursore - cartiglio - 2, 3.8);
  for (const testo of controlliQui) {
    riga(pagina, testo, { font: penna.regolare, x: colonne[0], y: cursore, corpo: 6.5, larghezza: 86 });
    cursore -= 3.8;
  }

  // Quello che non sta nel foglio continua su un foglio di note, con le stesse voci per esteso.
  const resto = [
    ...(misureDopo.length > 0 ? [testi.misure, ...misureDopo] : []),
    ...(pezziDopo.length > 0
      ? [
          testi.colonnaPezzo,
          ...pezziDopo.map(
            (pezzo) =>
              `${pezzo.nome} · ${pezzo.materiale ?? '—'} · ${pezzo.processo ?? '—'} · ${
                pezzo.pesoGrammi === undefined ? '—' : `${numero(pezzo.pesoGrammi, lingua, 1)} g`
              }`,
          ),
        ]
      : []),
    ...(controlliDopo.length > 0 ? [testi.producibilita, ...controlliDopo] : []),
  ].slice(0, 38);
  const fogli = resto.length > 0 ? 2 : 1;

  // Il cartiglio.
  const voci: Array<[string, string]> = [
    [testi.progetto, dati.progetto],
    [testi.pezzi, dati.selezione],
    [testi.versione, dati.versione],
    [testi.data, data(dati.data, lingua)],
    [testi.scala, `${scritturaScala(scala)} · ${testi.unita} · ${testi.proiezione}`],
    [testi.foglio, `1/${String(fogli)}`],
  ];
  riga(pagina, 'SinopiaCAD', { font: penna.grassetto, x: colonna + 3, y: cartiglio - 7, corpo: 11 });
  riga(pagina, testi.titolo, {
    font: penna.regolare,
    x: colonna + 40,
    y: cartiglio - 7,
    corpo: 8,
    colore: grigio,
    larghezza: 48,
  });
  linea(
    pagina,
    [
      [colonna, cartiglio - 10],
      [destra, cartiglio - 10],
    ],
    { spessore: 0.13, colore: chiaro },
  );
  for (const [indice, [etichetta, valore]] of voci.entries()) {
    const yRiga = cartiglio - 15 - indice * 4.6;
    riga(pagina, etichetta, {
      font: penna.regolare,
      x: colonna + 3,
      y: yRiga,
      corpo: 6.5,
      colore: grigio,
      larghezza: 22,
    });
    riga(pagina, valore, { font: penna.grassetto, x: colonna + 26, y: yRiga, corpo: 7.5, larghezza: 62 });
  }

  if (resto.length > 0) {
    riga(pagina, testi.segue, { font: penna.regolare, x: colonne[0], y: cartiglio + 2, corpo: 6.5, colore: grigio });
    const note = documento.addPage([foglio.larghezza * mm, foglio.altezza * mm]);
    riga(note, `SinopiaCAD · ${dati.progetto} · ${testi.note}`, {
      font: penna.grassetto,
      x: margine,
      y: alto - 4,
      corpo: 10,
    });
    riga(note, `${testi.foglio} 2/2`, { font: penna.regolare, x: destra - 20, y: alto - 4, corpo: 8, colore: grigio });
    for (const [indice, testo] of resto.entries()) {
      riga(note, testo, {
        font: penna.regolare,
        x: margine,
        y: alto - 14 - indice * 4.5,
        corpo: 8,
        larghezza: destra - margine,
      });
    }
  }
  return new Uint8Array(await documento.save());
}
