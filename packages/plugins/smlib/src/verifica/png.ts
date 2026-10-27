/**
 * PNG senza canvas per la verifica D3: decodifica (con l'alfa, che il decodificatore di smlibwasm scarta) e codifica
 * delle immagini differenza. Usa `DecompressionStream`/`CompressionStream('deflate')`, presenti nei worker del browser
 * e in Node ≥ 18: la stessa via nel worker e nei test, senza `OffscreenCanvas` (che jsdom e Node non hanno).
 *
 * Letti: profondità 1, 2, 4, 8 e 16 bit (16 → byte alto), tipi grigio, grigio+alfa, RGB, RGBA e tavolozza (con
 * `tRNS`), non interlacciati. Gli interlacciati Adam7 danno `RangeError`: il chiamante può ripiegare su
 * `createImageBitmap` dove c'è.
 */

/** Pixel riga per riga dall'alto a sinistra, `canali` byte ciascuno (1 grigio, 2 grigio+alfa, 3 RGB, 4 RGBA). */
export type ImmagineRaster = {
  larghezza: number;
  altezza: number;
  canali: 1 | 2 | 3 | 4;
  dati: Uint8Array | Uint8ClampedArray;
};

const FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

async function trasforma(dati: Uint8Array, flusso: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const uscita = new Blob([dati as Uint8Array<ArrayBuffer>]).stream().pipeThrough(flusso);
  return new Uint8Array(await new Response(uscita).arrayBuffer());
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Decodifica un PNG.
 * @param bytes - Contenuto del file.
 * @returns I pixel con i loro canali (la tavolozza diventa RGB o RGBA).
 */
export async function decodificaPng(bytes: Uint8Array): Promise<ImmagineRaster> {
  if (bytes.length < 8 || FIRMA.some((byte, indice) => bytes[indice] !== byte)) {
    throw new RangeError('Non è un file PNG.');
  }
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let posizione = 8;
  let [larghezza, altezza, profondita, tipo, interlacciato] = [0, 0, 0, 0, 0];
  let tavolozza: Uint8Array | undefined;
  let trasparenza: Uint8Array | undefined;
  const blocchi: Uint8Array[] = [];
  while (posizione + 8 <= bytes.length) {
    const lunghezza = vista.getUint32(posizione);
    const nome = String.fromCodePoint(...bytes.subarray(posizione + 4, posizione + 8));
    const corpo = bytes.subarray(posizione + 8, posizione + 8 + lunghezza);
    if (nome === 'IHDR') {
      const intestazione = new DataView(corpo.buffer, corpo.byteOffset, corpo.byteLength);
      larghezza = intestazione.getUint32(0);
      altezza = intestazione.getUint32(4);
      [profondita, tipo, interlacciato] = [corpo[8]!, corpo[9]!, corpo[12]!];
    } else if (nome === 'PLTE') {
      tavolozza = corpo;
    } else if (nome === 'tRNS') {
      trasparenza = corpo;
    } else if (nome === 'IDAT') {
      blocchi.push(corpo);
    } else if (nome === 'IEND') {
      break;
    }
    posizione += 12 + lunghezza;
  }
  const campioni = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipo];
  if (campioni === undefined || ![1, 2, 4, 8, 16].includes(profondita) || larghezza === 0 || altezza === 0) {
    throw new RangeError(`PNG non supportato (tipo ${tipo}, ${profondita} bit).`);
  }
  if (interlacciato) {
    throw new RangeError('PNG interlacciato (Adam7): non supportato senza canvas.');
  }
  const compresso = new Uint8Array(blocchi.reduce((somma, blocco) => somma + blocco.length, 0));
  let scritto = 0;
  for (const blocco of blocchi) {
    compresso.set(blocco, scritto);
    scritto += blocco.length;
  }
  const grezzo = await trasforma(compresso, new DecompressionStream('deflate'));
  const bitPerPixel = campioni * profondita;
  const passoRiga = Math.ceil((larghezza * bitPerPixel) / 8);
  const bytePerPixel = Math.max(1, bitPerPixel / 8);
  if (grezzo.length < altezza * (passoRiga + 1)) {
    throw new RangeError('PNG troncato: i dati dell’immagine finiscono prima.');
  }
  const righe = new Uint8Array(altezza * passoRiga);
  for (let y = 0; y < altezza; y++) {
    const filtro = grezzo[y * (passoRiga + 1)]!;
    const sorgente = grezzo.subarray(y * (passoRiga + 1) + 1, (y + 1) * (passoRiga + 1));
    const riga = righe.subarray(y * passoRiga, (y + 1) * passoRiga);
    const sopra = y > 0 ? righe.subarray((y - 1) * passoRiga, y * passoRiga) : new Uint8Array(passoRiga);
    for (let i = 0; i < passoRiga; i++) {
      const a = i >= bytePerPixel ? riga[i - bytePerPixel]! : 0;
      const b = sopra[i]!;
      const c = i >= bytePerPixel ? sopra[i - bytePerPixel]! : 0;
      const predetto =
        filtro === 1 ? a : filtro === 2 ? b : filtro === 3 ? (a + b) >> 1 : filtro === 4 ? paeth(a, b, c) : 0;
      riga[i] = (sorgente[i]! + predetto) & 0xff;
    }
  }
  // Campione k-esimo della riga y, portato a 8 bit.
  const massimo = (1 << Math.min(profondita, 8)) - 1;
  const campione = (y: number, k: number): number => {
    if (profondita === 16) {
      return righe[y * passoRiga + k * 2]!;
    }
    if (profondita === 8) {
      return righe[y * passoRiga + k]!;
    }
    const bit = k * profondita;
    const byte = righe[y * passoRiga + (bit >> 3)]!;
    const valore = (byte >> (8 - profondita - (bit & 7))) & massimo;
    return tipo === 3 ? valore : Math.round((valore * 255) / massimo);
  };
  if (tipo === 3) {
    if (!tavolozza) {
      throw new RangeError('PNG a tavolozza senza PLTE.');
    }
    const canali = trasparenza ? 4 : 3;
    const dati = new Uint8Array(larghezza * altezza * canali);
    for (let y = 0; y < altezza; y++) {
      for (let x = 0; x < larghezza; x++) {
        const indice = campione(y, x);
        const k = (y * larghezza + x) * canali;
        dati[k] = tavolozza[indice * 3] ?? 0;
        dati[k + 1] = tavolozza[indice * 3 + 1] ?? 0;
        dati[k + 2] = tavolozza[indice * 3 + 2] ?? 0;
        if (canali === 4) {
          dati[k + 3] = trasparenza?.[indice] ?? 255;
        }
      }
    }
    return { larghezza, altezza, canali, dati };
  }
  const canali = campioni as 1 | 2 | 3 | 4;
  const dati = new Uint8Array(larghezza * altezza * canali);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      for (let c = 0; c < canali; c++) {
        dati[(y * larghezza + x) * canali + c] = campione(y, x * canali + c);
      }
    }
  }
  return { larghezza, altezza, canali, dati };
}

const tabellaCrc = (() => {
  const tabella = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    tabella[n] = c >>> 0;
  }
  return tabella;
})();

const crc32 = (dati: Uint8Array): number => {
  let c = 0xff_ff_ff_ff;
  for (const byte of dati) {
    c = tabellaCrc[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0;
};

const blocco = (nome: string, corpo: Uint8Array): Uint8Array => {
  const uscita = new Uint8Array(12 + corpo.length);
  const vista = new DataView(uscita.buffer);
  vista.setUint32(0, corpo.length);
  for (let i = 0; i < 4; i++) {
    uscita[4 + i] = nome.codePointAt(i)!;
  }
  uscita.set(corpo, 8);
  vista.setUint32(8 + corpo.length, crc32(uscita.subarray(4, 8 + corpo.length)));
  return uscita;
};

/**
 * Codifica un PNG a 8 bit (filtro nullo: le immagini della verifica sono piccole).
 * @param immagine - Pixel da scrivere.
 * @returns Il contenuto del file.
 */
export async function codificaPng(immagine: ImmagineRaster): Promise<Uint8Array> {
  const { larghezza, altezza, canali, dati } = immagine;
  const intestazione = new Uint8Array(13);
  const vista = new DataView(intestazione.buffer);
  vista.setUint32(0, larghezza);
  vista.setUint32(4, altezza);
  intestazione[8] = 8;
  intestazione[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[canali];
  const grezzo = new Uint8Array(altezza * (larghezza * canali + 1));
  for (let y = 0; y < altezza; y++) {
    grezzo.set(dati.subarray(y * larghezza * canali, (y + 1) * larghezza * canali), y * (larghezza * canali + 1) + 1);
  }
  const compresso = await trasforma(grezzo, new CompressionStream('deflate'));
  const parti = [
    new Uint8Array(FIRMA),
    blocco('IHDR', intestazione),
    blocco('IDAT', compresso),
    blocco('IEND', new Uint8Array(0)),
  ];
  const uscita = new Uint8Array(parti.reduce((somma, parte) => somma + parte.length, 0));
  let scritto = 0;
  for (const parte of parti) {
    uscita.set(parte, scritto);
    scritto += parte.length;
  }
  return uscita;
}
