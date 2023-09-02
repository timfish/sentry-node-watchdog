import { nodeResolve } from "@rollup/plugin-node-resolve";
import esbuild from "rollup-plugin-esbuild";
import terser from "@rollup/plugin-terser";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";

export default [
  {
    input: `src/worker.ts`,
    plugins: [
      nodeResolve(),
      commonjs(),
      esbuild({ tsconfig: "tsconfig.worker.json" }),
      replace({
        __SENTRY_DEBUG__: JSON.stringify(false),
        preventAssignment: true,
      }),
      terser(),
      {
        name: "output-worker-script",
        generateBundle(_, bundle) {
          const entry = Object.values(bundle).find((chunk) => chunk.isEntry);
          this.emitFile({
            type: "asset",
            fileName: "worker-script.ts",
            source: `export const base64WorkerScript = "${Buffer.from(
              entry.code
            ).toString("base64")}";`,
          });
        },
      },
    ],
    output: [
      {
        file: `src/_bundle.mjs`,
        format: "es",
      },
    ],
  },
];
