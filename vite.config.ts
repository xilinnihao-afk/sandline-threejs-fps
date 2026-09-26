import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{target:'es2022',chunkSizeWarningLimit:700,rollupOptions:{output:{manualChunks:{three:['three']}}}},server:{host:'0.0.0.0',port:5190,strictPort:true},preview:{host:'0.0.0.0',port:5190,strictPort:true}});
