// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scatole } from '#lib/foto-campione/cubo.fixture.js';
import { chiaveFoto, fotoPronta, statiFoto, ultimePerChiave } from '#lib/foto-campione/galleria.js';
import type { FotoCampione } from '#lib/foto-campione/galleria.js';
import { improntaFoto } from '#lib/foto-campione/impronta.js';
import { rendiMappe } from '#lib/foto-campione/mappe.js';
import { fotoDiProva } from '#lib/foto-campione/prova.js';
import { iouSagome, sagomaDaFoto, sogliaIouFoto } from '#lib/foto-campione/sagoma.js';

const base = { modello: 'sha-model-a', vista: 'fronte', materiale: { id: 'brass' }, livello: 'standard' } as const;

describe('sample photo fingerprint', () => {
  it('should be 64 hexadecimal digits, the same for the same inputs', async () => {
    const impronta = await improntaFoto(base);
    expect(impronta).toMatch(/^[\da-f]{64}$/u);
    expect(await improntaFoto({ ...base })).toBe(impronta);
  });

  it('should change with the model, the view, the material, the finish and the level — and only with them', async () => {
    const impronta = await improntaFoto(base);
    const varianti = await Promise.all([
      improntaFoto({ ...base, modello: 'sha-model-b' }),
      improntaFoto({ ...base, vista: 'tre-quarti' }),
      improntaFoto({ ...base, materiale: { id: 'zamak' } }),
      improntaFoto({ ...base, materiale: { id: 'brass', finitura: 'satin' } }),
      improntaFoto({ ...base, livello: 'fedele' }),
    ]);
    expect(new Set([impronta, ...varianti]).size).toBe(6);
    // A metal without a finish is polished; a finish on leather means nothing.
    expect(await improntaFoto({ ...base, materiale: { id: 'brass', finitura: 'polished' } })).toBe(impronta);
    expect(await improntaFoto({ ...base, materiale: { id: 'leather', finitura: 'satin' } })).toBe(
      await improntaFoto({ ...base, materiale: { id: 'leather' } }),
    );
  });
});

const foto = (id: string, creata: number, impronta: string, sovrascrivi: Partial<FotoCampione> = {}): FotoCampione => ({
  id,
  vista: 'fronte',
  materiale: { id: 'brass', finitura: 'polished' },
  livello: 'standard',
  impronta,
  creata,
  sorgente: { tipo: 'url', url: `blob:${id}` },
  ...sovrascrivi,
});

describe('sample photo gallery', () => {
  it('should keep the newest photo of each view × material × level', () => {
    const galleria = ultimePerChiave([
      foto('vecchia', 1, 'a'),
      foto('nuova', 3, 'b'),
      foto('fedele', 2, 'c', { livello: 'fedele' }),
      foto('pelle', 0, 'd', { materiale: { id: 'leather' } }),
    ]);
    expect(galleria.map((voce) => voce.id)).toStrictEqual(['nuova', 'fedele', 'pelle']);
    expect(chiaveFoto({ ...base, materiale: { id: 'brass' } })).toBe(
      chiaveFoto({ ...base, materiale: { id: 'brass', finitura: 'polished' } }),
    );
  });

  it('should mark a photo «da rifare» as soon as the model changes, and never before', async () => {
    const impronta = await improntaFoto(base);
    const galleria = [foto('f1', 1, impronta)];
    expect((await statiFoto(galleria, 'sha-model-a')).get('f1')).toBe('pronta');
    expect((await statiFoto(galleria, 'sha-model-b')).get('f1')).toBe('da-rifare');
    // The model still building: no verdict yet.
    expect((await statiFoto(galleria, undefined)).size).toBe(0);
  });

  it('should find the ready photo of a fingerprint (the cache that spares a second payment)', async () => {
    const impronta = await improntaFoto(base);
    const galleria = [foto('f1', 1, impronta)];
    expect(fotoPronta(galleria, impronta)?.id).toBe('f1');
    expect(fotoPronta(galleria, await improntaFoto({ ...base, modello: 'sha-model-b' }))).toBeUndefined();
    expect(fotoPronta(galleria, undefined)).toBeUndefined();
  });
});

describe('sample photo silhouette check', () => {
  const cubo = scatole({ min: [-10, -10, -10], max: [10, 10, 10] });
  const mappe = rendiMappe(cubo, 'tre-quarti', 256);

  it('should read the object off a white background, keep a faint shadow out, and resample to the maps’ side', () => {
    const lato = 512;
    const dati = new Uint8Array(lato * lato * 3).fill(255);
    for (let y = 0; y < lato; y++) {
      for (let x = 0; x < lato; x++) {
        const p = (y * lato + x) * 3;
        if (x >= 128 && x < 384 && y >= 128 && y < 384) {
          dati.set([120, 90, 60], p);
        } else if (y >= 384 && y < 400) {
          dati.set([232, 232, 230], p);
        }
      }
    }
    const sagoma = sagomaDaFoto({ larghezza: lato, altezza: lato, canali: 3, dati }, 256);
    const attesa = new Uint8Array(256 * 256);
    for (let y = 64; y < 192; y++) {
      attesa.fill(1, y * 256 + 64, y * 256 + 192);
    }
    expect(iouSagome(sagoma, { larghezza: 256, altezza: 256, dati: attesa })).toBe(1);
  });

  it('should pass a faithful photo and warn under 0.95 for one that drifted', () => {
    const fedele = sagomaDaFoto(fotoDiProva(mappe, { id: 'brass', finitura: 'polished' }, 'fedele'), 256);
    const standard = sagomaDaFoto(fotoDiProva(mappe, { id: 'brass', finitura: 'polished' }, 'standard'), 256);
    expect(iouSagome(fedele, mappe.sagoma)).toBeGreaterThanOrEqual(0.99);
    expect(iouSagome(standard, mappe.sagoma)).toBeLessThan(sogliaIouFoto);
    expect(sogliaIouFoto).toBe(0.95);
  });

  it('should refuse silhouettes of different sizes', () => {
    expect(() => iouSagome(mappe.sagoma, { larghezza: 2, altezza: 2, dati: new Uint8Array(4) })).toThrow();
  });
});
