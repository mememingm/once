import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  resolve: { alias: { "@": resolve(root, "src") } },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "once-static-assets",
      closeBundle() {
        mkdirSync(resolve(root, "dist/assets"), { recursive: true });
        cpSync(
          resolve(root, "assets/icons"),
          resolve(root, "dist/assets/icons"),
          { recursive: true },
        );
        cpSync(resolve(root, "favicon.svg"), resolve(root, "dist/favicon.svg"));
      },
    },
  ],
  publicDir: "public",
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, incomingRequest) => {
            if (
              ["http://127.0.0.1:5174", "http://localhost:5174"].includes(
                incomingRequest.headers.origin || "",
              )
            ) {
              proxyRequest.setHeader("origin", "http://127.0.0.1:3000");
            }
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          motion: ["motion/react"],
          ui: ["radix-ui", "cmdk", "vaul", "sonner"],
        },
      },
      input: {
        main: resolve(root, "index.html"),
        demo: resolve(root, "assets/ux/demo.html"),
      },
    },
  },
});
