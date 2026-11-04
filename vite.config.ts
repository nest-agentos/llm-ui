import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    build: {
        lib: { entry: resolve(__dirname, 'src/index.ts'), name: 'LLMUI', formats: ['es', 'umd'],
            fileName: format => `llm-ui.${format === 'es' ? 'js' : 'umd.cjs'}` },
        sourcemap: true, emptyOutDir: true, cssCodeSplit: false,
        rollupOptions: { external: ['@itookit/mdxeditor', '@itookit/ui-common', './flow.js'], output: {
            globals: { '@itookit/mdxeditor': 'MDxEditor', '@itookit/ui-common': 'ItookitUICommon' },
            assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : '[name][extname]',
        } },
    },
});
