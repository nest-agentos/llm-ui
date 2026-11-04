import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';

export default defineConfig({ plugins: [{ name: 'forms-styles', closeBundle() { copyFileSync(resolve(__dirname, 'src/forms.css'), resolve(__dirname, 'dist/forms.css')); } }], build: {
    lib: { entry: resolve(__dirname, 'src/parameter-form.ts'), formats: ['es', 'cjs'], fileName: format => format === 'es' ? 'forms.js' : 'forms.cjs' },
    emptyOutDir: false,
} });
