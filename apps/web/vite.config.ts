import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Load env (incl. VITE_* like VITE_PRIVY_APP_ID) from the monorepo root, the
  // single source of truth the api also reads. Without this, Vite defaults
  // envDir to apps/web/ and never sees the root .env → empty appId → blank page.
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // GraphQL queries/mutations + GraphiQL proxied to the api (apps/api on :4000).
      "/graphql": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
      // REST side-routes (Privy spike verify, future /api/* endpoints).
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
