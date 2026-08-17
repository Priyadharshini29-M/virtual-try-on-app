import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Standalone preview server for the Analytics module — no Shopify OAuth,
// no PHP backend, no plan-gate dependency. Mock data only.
export default defineConfig({
  root: "preview",
  server: {
    port: 5180,
  },
  esbuild: {
    jsx: "automatic",
  },
  plugins: [tailwindcss()],
});
