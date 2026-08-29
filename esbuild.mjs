/**
 * Bundles the two distributable entry points.
 *
 * esbuild does no type checking — `npm run check` runs tsc for that, and both
 * are wired into `npm run build`. Never ship a bundle without the type check.
 *
 * Both bundles are CommonJS: the VS Code extension host requires it, and the
 * MCP server is launched as a plain node script. Bundling also removes the
 * ESM/CJS interop dance around @babel/parser and @babel/traverse — they are
 * ESM-only, so unbundled code has to reach them through a dynamic import.
 */
import { readFileSync } from "fs";
import esbuild from "esbuild";

// The MCP server reports its version over the wire. Injecting it here keeps that
// one number in package.json instead of drifting in a second hand-edited literal.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import("esbuild").BuildOptions} */
const shared = {
    bundle: true,
    platform: "node",
    format: "cjs",
    // VS Code 1.85 ships Node 18; the MCP server requires Node 22.
    target: "node18",
    minify: production,
    sourcemap: production ? false : "linked",
    define: { __PACKAGE_VERSION__: JSON.stringify(version) },
    logLevel: "info"
};

const targets = [
    {
        ...shared,
        entryPoints: ["src/extension/extension.ts"],
        outfile: "dist/extension.js",
        // Provided by the extension host at runtime, never bundled.
        external: ["vscode"]
    },
    {
        ...shared,
        entryPoints: ["src/mcp/server.ts"],
        outfile: "dist/mcp-server.js",
        banner: { js: "#!/usr/bin/env node" }
    }
];

if (watch) {
    const contexts = await Promise.all(targets.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((context) => context.watch()));
    console.log("esbuild: watching for changes…");
} else {
    await Promise.all(targets.map((options) => esbuild.build(options)));
}
