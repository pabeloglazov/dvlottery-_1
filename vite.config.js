import { defineConfig } from "vite";

// Относительные пути — сайт работает и на GitHub Pages (/dvlottery-_1/), и на своём домене.
export default defineConfig({ base: "./", esbuild: { jsx: "automatic" } });
