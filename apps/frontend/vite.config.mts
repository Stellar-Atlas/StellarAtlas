import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue2";
import topLevelAwait from "vite-plugin-top-level-await";
import { viteStaticCopy } from "vite-plugin-static-copy";
import eslint from "vite-plugin-eslint";

const legacyBasePath = process.env.LEGACY_FRONTEND_BASE_PATH ?? "/legacy/";
const legacySassDeprecations = [
  "abs-percent",
  "color-functions",
  "global-builtin",
  "if-function",
  "import",
] as const;

/** @type {import('vite').UserConfig} */
export default defineConfig({
  base: legacyBasePath,
  plugins: [
    vue(),
    eslint(),
    topLevelAwait(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/shared/schemas/*",
          dest: "schemas",
        },
      ],
    }),
  ],
  envPrefix: "VUE_",
  worker: {
    plugins: () => [],
  },
  resolve: {
    alias: {
      "@": "/src",
    },
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  define: {
    "process.env": Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        key.startsWith("VUE_")
      )
    ),
  },
  build: {
    commonjsOptions: {
      include: [
        /shared/,
        /node_modules/,
        /shared\/lib\/network-schema/,
        /scp-simulation/,
      ],
    },
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.message.includes("bootstrap-vue")
        ) {
          return;
        }

        defaultHandler(warning);
      },
      output: {
        manualChunks: {
          d3: [
            "d3-force",
            "d3-shape",
            "d3-selection",
            "d3-zoom",
            "d3-polygon",
            "d3-drag",
          ],
          jquery: ["jquery"],
          vue: ["vue", "vue-router", "vue-multiselect", "portal-vue"],
          sentry: ["@sentry/vue"],
          shared: ["shared"],
          "scp-simulation": ["scp-simulation"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["shared", "shared/lib/network-schema", "scp-simulation"],
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        includePaths: ["src"],
        quietDeps: true,
        silenceDeprecations: [...legacySassDeprecations],
      },
    },
  },
  server: {
    allowedHosts: ["stellaratlas.io", "www.stellaratlas.io", "localhost", "stellarbeat-host"],
  },
});
