import { defineConfig } from "vite";
export default defineConfig({ base: process.env.GITHUB_PAGES ? "/goguryeo/" : "./", server: { port: 5451, strictPort: true }, build: { target: "es2022", chunkSizeWarningLimit: 2000 } });
