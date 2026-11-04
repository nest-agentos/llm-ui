import {defineConfig} from 'tsup';

/** Emit portable ESM/CJS declarations after Vite has built browser JavaScript and CSS. */
export default defineConfig({entry: {"settings": "src/settings.ts", "index": "src/index.ts", "flow": "src/flow.ts", "parameter-form": "src/parameter-form.ts"}, format: ['esm', 'cjs'],
    dts: {only: true}, clean: false, outDir: 'dist'});
