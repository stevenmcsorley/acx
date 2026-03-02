import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, "../../node_modules/cesium/Build/Cesium/*"),
          dest: "Cesium"
        }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/Cesium")
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
