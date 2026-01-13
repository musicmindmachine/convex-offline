import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		rollupOptions: {
			external: [/^@trestleinc\/replicate\/worker/],
			onwarn(warning, warn) {
				if (warning.code === "CIRCULAR_DEPENDENCY" && warning.message.includes("node_modules")) {
					return;
				}
				warn(warning);
			},
		},
	},
	resolve: {
		alias: [
			{ find: "$convex", replacement: path.resolve("./src/convex") },
			{
				find: "@trestleinc/replicate/client",
				replacement: path.resolve("../../dist/client/index.js"),
			},
			{
				find: "@trestleinc/replicate/server",
				replacement: path.resolve("../../dist/server/index.js"),
			},
			{
				find: "@trestleinc/replicate/worker",
				replacement: path.resolve("../../dist/client/persistence/sqlite/worker.js"),
			},
		],
		dedupe: ["yjs", "lib0", "y-protocols"],
	},
	server: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	optimizeDeps: {
		exclude: ["@electric-sql/pglite"],
	},
	ssr: {
		noExternal: [/^@trestleinc\/replicate(?!\/worker)/],
		external: [/^@trestleinc\/replicate\/worker/],
	},
});
