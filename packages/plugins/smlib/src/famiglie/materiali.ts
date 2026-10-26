/**
 * Materiali delle famiglie (specifica §1.11): chiavi stabili, densità in g/cm³ (come `ShapeConfig.density`, che il
 * kernel trasforma in massa con il volume esatto), colore e finitura di resa. La resa e il peso per materiale li
 * mostra il visore; qui si dichiarano soltanto.
 */
export type Materiale = {
  chiave: string;
  nome: string;
  /** g/cm³. */
  densita: number;
  colore: string;
  metalness: number;
  roughness: number;
  /** Metallo (per il peso del gioiello) o polimero/organico. */
  tipo: 'metallo_prezioso' | 'metallo' | 'polimero' | 'organico';
};

const metallo = (
  chiave: string,
  nome: string,
  densita: number,
  colore: string,
  tipo: 'metallo_prezioso' | 'metallo' = 'metallo',
  roughness = 0.3,
): Materiale => ({ chiave, nome, densita, colore, metalness: 1, roughness, tipo });

const nonMetallo = (
  chiave: string,
  nome: string,
  densita: number,
  colore: string,
  tipo: 'polimero' | 'organico' = 'polimero',
  roughness = 0.6,
): Materiale => ({ chiave, nome, densita, colore, metalness: 0, roughness, tipo });

const elenco: readonly Materiale[] = [
  metallo('oro_18kt_giallo', 'Oro 18 kt giallo', 15.5, '#d4ab62', 'metallo_prezioso', 0.22),
  metallo('oro_18kt_rosa', 'Oro 18 kt rosa', 15, '#d99a85', 'metallo_prezioso', 0.22),
  metallo('oro_18kt_bianco', 'Oro 18 kt bianco', 15.9, '#c9ced3', 'metallo_prezioso', 0.22),
  metallo('oro_14kt', 'Oro 14 kt', 13.5, '#d1a95c', 'metallo_prezioso', 0.24),
  metallo('oro_9kt', 'Oro 9 kt', 11.2, '#c9a35e', 'metallo_prezioso', 0.26),
  metallo('argento_925', 'Argento 925', 10.4, '#d7d9dc', 'metallo_prezioso', 0.25),
  metallo('platino_950', 'Platino 950', 20.5, '#cfd2d4', 'metallo_prezioso', 0.25),
  metallo('titanio', 'Titanio', 4.5, '#8f9499'),
  metallo('ottone', 'Ottone', 8.5, '#b8995a'),
  metallo('zama', 'Zama', 6.7, '#9aa0a6'),
  metallo('acciaio', 'Acciaio', 7.85, '#8c9095'),
  metallo('inox', 'Acciaio inox', 7.9, '#a8adb2'),
  metallo('alluminio', 'Alluminio', 2.7, '#c0c4c8'),
  metallo('bronzo', 'Bronzo', 8.8, '#a87a4a'),
  nonMetallo('abs', 'ABS', 1.05, '#2b2b2b'),
  nonMetallo('pa6', 'PA6', 1.14, '#3a3a3a'),
  nonMetallo('pa_gf30', 'PA + vetro 30 %', 1.36, '#333333'),
  nonMetallo('pu', 'Poliuretano', 1.2, '#262626'),
  nonMetallo('tpu', 'TPU', 1.2, '#1f1f1f', 'polimero', 0.75),
  nonMetallo('legno_faggio', 'Legno di faggio', 0.72, '#c8a27a', 'organico', 0.7),
  nonMetallo('sughero', 'Sughero', 0.25, '#b58a5a', 'organico', 0.9),
  nonMetallo('tr', 'TR (gomma termoplastica)', 0.98, '#2e2e2e', 'polimero', 0.8),
  nonMetallo('gomma', 'Gomma vulcanizzata', 1.15, '#1c1c1c', 'polimero', 0.85),
  nonMetallo('eva', 'EVA', 0.2, '#d9d4cc', 'polimero', 0.85),
  nonMetallo('pu_espanso', 'PU espanso', 0.55, '#e1ddd5', 'polimero', 0.85),
  nonMetallo('cuoio', 'Cuoio', 0.9, '#8b5a2b', 'organico', 0.7),
];

/** Materiali per chiave. */
export const materiali: Readonly<Record<string, Materiale>> = Object.fromEntries(
  elenco.map((materiale) => [materiale.chiave, materiale]),
);

/**
 * Il materiale di una chiave.
 * @param chiave - Chiave stabile (`ottone`, `abs`…).
 * @returns Il materiale.
 */
export function materiale(chiave: string): Materiale {
  const trovato = materiali[chiave];
  if (!trovato) {
    throw new RangeError(`Materiale sconosciuto: ${chiave}.`);
  }
  return trovato;
}

/**
 * I campi di resa e di densità di un `ShapeConfig` per un materiale.
 * @param chiave - Chiave del materiale.
 * @returns color, density, metalness, roughness.
 */
export function aspettoMateriale(chiave: string): {
  color: string;
  density: number;
  metalness: number;
  roughness: number;
} {
  const { colore, densita, metalness, roughness } = materiale(chiave);
  return { color: colore, density: densita, metalness, roughness };
}
