import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.resolve(process.argv[2] ?? "");
const relative = path.relative(root, target);
const withinRoot = relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
if (!process.argv[2] || withinRoot || (await readdir(target).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return [];
})).length) throw new Error("Provide an empty, explicit packaging directory outside the repository root.");
process.chdir(root);
process.env.VITE_ARM_MODE = "hosted";
process.env.VITE_BASE = "/";
await build({ root });
const html = await readFile(path.join(root, "dist", "index.html"), "utf8");
if (!html.includes('/assets/')) throw new Error("The hosted build did not produce root-relative assets.");
await mkdir(target, { recursive: true });
for (const file of ["dist", "server/app.mjs", "src/lib/arm-http.ts", "src/lib/arm-config.ts", "scripts/dashboard-items.mjs", "api/retail-prices/index.cjs"]) {
  await cp(path.join(root, file), path.join(target, file), { recursive: true });
}
await cp(path.join(root, "server/package.json"), path.join(target, "package.json"));
await writeFile(path.join(target, "deployment.json"), JSON.stringify({ builtAt: new Date().toISOString(), revision: process.env.GITHUB_SHA ?? "manual" }));
console.log("Packaged hosted frontend and dependency-free backend; no local environment or credential files included.");
