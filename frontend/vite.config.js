import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project site: https://<user>.github.io/<repo>/
// Local dev uses "/" (http://localhost:5173/). CI sets VITE_BASE_PATH in deploy.yml.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
    plugins: [react()],
    base,
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
