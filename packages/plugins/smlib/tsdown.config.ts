import { defineConfig } from 'tsdown';
import type { UserConfig } from 'tsdown';

const baseConfig: UserConfig = {
  entry: [
    'src/index.ts',
    'src/model.ts',
    'src/manual-operations.ts',
    'src/famiglie/index.ts',
    'src/riconoscimento/index.ts',
    'src/verifica/index.ts',
    'src/verifica/verifica.worker.ts',
    'src/varianti/index.ts',
    'src/varianti/varianti.worker.ts',
    'src/producibilita/index.ts',
    'src/producibilita/producibilita.worker.ts',
  ],
  sourcemap: false,
  clean: true,
  dts: true,
  minify: true,
  tsconfig: 'tsconfig.build.json',
  unbundle: true,
};

const packageConfig: UserConfig = {
  ...baseConfig,
  format: 'esm',
  outDir: 'dist',
};

export default defineConfig(packageConfig);
