import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({build:{
    lib:{entry:resolve(__dirname,'src/settings.ts'),formats:['es','cjs'],fileName:format=>format==='es'?'settings.js':'settings.cjs'},
    emptyOutDir:false,rollupOptions:{external:['@nestos/ui-common','@nestos/mdxeditor'],output:{assetFileNames:asset=>asset.name?.endsWith('.css')?'settings.css':'[name][extname]'}},
}});
