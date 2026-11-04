import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    build: {
        lib: { entry: resolve(__dirname, 'src/index.ts'), name: 'LLMUI', formats: ['es', 'umd'],
            fileName: format => `llm-ui.${format === 'es' ? 'js' : 'umd.cjs'}` },
        sourcemap: true, emptyOutDir: true, cssCodeSplit: false,
        rollupOptions: { external: ['@nestos/mdxeditor', '@nestos/ui-common', './flow.js'], output: {
            globals: { '@nestos/mdxeditor': 'MDxEditor', '@nestos/ui-common': 'ItookitUICommon' },
            assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : '[name][extname]',
        } },
    },
});
