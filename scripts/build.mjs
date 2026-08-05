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
  copyIfPresent("node_modules/@vscode/codicons/LICENSE-CODE", "media/codicon.LICENSE-CODE.txt")
]);

const options = {
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

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching extension sources…");
} else {
  await esbuild.build(options);
}
