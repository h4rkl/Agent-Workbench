import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");

await mkdir("dist", { recursive: true });

async function copyIfPresent(source, target) {
  try {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

await Promise.all([
  copyIfPresent("media/icon.png", "dist/icon.png"),
  copyIfPresent("node_modules/@vscode/codicons/dist/codicon.css", "media/codicon.css"),
  copyIfPresent("node_modules/@vscode/codicons/dist/codicon.ttf", "media/codicon.ttf"),
  copyIfPresent("node_modules/@vscode/codicons/LICENSE", "media/codicon.LICENSE.txt"),
  copyIfPresent("node_modules/@vscode/codicons/LICENSE-CODE", "media/codicon.LICENSE-CODE.txt"),
  copyIfPresent("node_modules/@gitgraph/core/LICENSE.md", "media/gitgraph-core.LICENSE.md")
]);

const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info"
};

const gitgraphOptions = {
  entryPoints: ["src/gitgraphWebview.ts"],
  bundle: true,
  outfile: "media/gitgraph-core.js",
  format: "iife",
  globalName: "GitgraphCoreApi",
  platform: "browser",
  target: "es2022",
  minify: true,
  logLevel: "info"
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(gitgraphOptions)
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching extension sources…");
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(gitgraphOptions)
  ]);
}
