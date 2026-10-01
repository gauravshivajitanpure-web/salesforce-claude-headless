import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const input = process.env.INPUT || "mcp-app.html";
const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
    plugins: [react(), viteSingleFile()],
    build: {
        outDir: "dist",
        emptyOutDir: false,
        sourcemap: isDevelopment ? "inline" : false,
        minify: !isDevelopment,
        cssMinify: !isDevelopment,
        rollupOptions: {
            input
        }
    }
});
