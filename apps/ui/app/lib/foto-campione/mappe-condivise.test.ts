// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scatole } from '#lib/foto-campione/cubo.fixture.js';
import { stessaForma } from '#lib/foto-campione/confronto.js';
import { codificaPngFoto, rendiMappe, sha256Foto } from '#lib/foto-campione/mappe-condivise.js';

/**
 * Fingerprint of the twin file (`mappe-condivise.ts`): the same value is written in Sinopia's
 * `supabase/functions/sinopiacad/photo.test.ts`. If you change the file, copy it to
 * `supabase/functions/sinopiacad/foto/mappe-condivise.ts` and update the fingerprint in BOTH tests.
 */
const improntaGemella = 'd237c22f09d2a7ee62595fa80665474e477017978f4272b0d249fc44071215a2';

describe('twin maps module (CAD ↔ Sinopia)', () => {
  it('should be the byte-for-byte copy Sinopia renders the photo maps with', async () => {
    const bytes = await readFile(new URL('mappe-condivise.ts', import.meta.url));
    expect(await sha256Foto(new Uint8Array(bytes))).toBe(improntaGemella);
  });

  it('should encode PNGs a PNG reader accepts, grey and RGB, with the IHDR the function checks', async () => {
    const mappe = rendiMappe(scatole({ min: [-10, -10, -20], max: [10, 10, 20] }), 'tre-quarti', 64);
    const grigio = await codificaPngFoto(mappe.ombreggiata);
    const rgb = await codificaPngFoto(mappe.normali);
    const vista = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([...grigio.subarray(0, 8)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([vista(grigio).getUint32(16), vista(grigio).getUint32(20), grigio[24], grigio[25]]).toStrictEqual([
      64, 64, 8, 0,
    ]);
    expect([rgb[24], rgb[25]]).toStrictEqual([8, 2]);
    const { decodificaPng } = await import('@taucad/smlib/verifica');
    const letta = await decodificaPng(rgb);
    expect([letta.larghezza, letta.canali]).toStrictEqual([64, 3]);
    expect([...letta.dati]).toStrictEqual([...mappe.normali.dati]);
  });
});

describe('screen model against the sent version', () => {
  const inviata = scatole({ min: [-10, -10, -20], max: [10, 10, 20] });

  it('should take the same shape for the same model, even tessellated or encoded differently', () => {
    expect(stessaForma(inviata, scatole({ min: [-10, -10, -20], max: [10, 10, 20] })).stessa).toBe(true);
    // A tenth of a millimetre of chordal difference is not a design change.
    expect(stessaForma(inviata, scatole({ min: [-10, -10, -20], max: [10.05, 10, 20] })).stessa).toBe(true);
  });

  it('should see a changed measure, a uniform scale and a moved part', () => {
    expect(stessaForma(inviata, scatole({ min: [-10, -10, -20], max: [11, 10, 20] })).stessa).toBe(false);
    const scalata = stessaForma(inviata, scatole({ min: [-10.5, -10.5, -21], max: [10.5, 10.5, 21] }));
    expect([scalata.stessa, scalata.misure]).toStrictEqual([false, false]);
    const conPezzo = stessaForma(
      scatole({ min: [-10, -10, -20], max: [10, 10, 20] }, { min: [-2, -14, 0], max: [2, -10, 4] }),
      scatole({ min: [-10, -10, -20], max: [10, 10, 20] }, { min: [-2, -14, 6], max: [2, -10, 10] }),
    );
    expect(conPezzo.stessa).toBe(false);
    // A part in front moved by 1 mm: no silhouette changes, the depth does.
    const unMillimetro = stessaForma(
      scatole({ min: [-10, -10, -20], max: [10, 10, 20] }, { min: [-2, -14, 0], max: [2, -10, 4] }),
      scatole({ min: [-10, -10, -20], max: [10, 10, 20] }, { min: [-2, -14, 1], max: [2, -10, 5] }),
    );
    expect([unMillimetro.stessa, unMillimetro.scarto]).toStrictEqual([false, 0]);
  });
});
