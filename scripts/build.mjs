import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");

await mkdir("dist", { recursive: true });

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

await copyIfPresent("media/icon.png", "dist/icon.png");
