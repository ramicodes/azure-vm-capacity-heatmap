import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { ArmReadError } from "../src/lib/arm-http.ts";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const lifetime = 15 * 60_000;
const maxBytes = 64 * 1024 * 1024;
const filenamePattern = /^[a-f0-9]{64}\.json\.gz$/;

export function skuCacheKey(context, subscriptionId) {
  return createHash("sha256").update(JSON.stringify([1, context, subscriptionId.toLowerCase()])).digest("hex");
}

export function createSkuCache(directory, now = Date.now) {
  const fileFor = (key) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new ArmReadError("catalog-cache", "Invalid local catalog cache key.");
    return path.join(directory, `${key}.json.gz`);
  };
  const failure = (error) => {
    console.error(`Local SKU cache failed (${error?.code ?? error?.name ?? "invalid-data"}). Cache directory: ${directory}`);
    return new ArmReadError("catalog-cache", "The local catalog cache could not be read or saved. Check the bridge terminal; clear the cache or disable ARM_SKU_CACHE and restart.");
  };
  return {
    async read(key, signal) {
      const file = fileFor(key);
      signal?.throwIfAborted();
      try {
        const info = await stat(file);
        if (info.size > maxBytes) throw new Error("Oversized cache");
        const data = JSON.parse(await decompress(await readFile(file, { signal }), { maxOutputLength: maxBytes }));
        signal?.throwIfAborted();
        if (data.version !== 1 || data.key !== key || !Number.isFinite(data.fetchedAt) ||
            !Array.isArray(data.value) || data.value.length > 100_000 ||
            data.value.some((item) => !item || item.resourceType !== "virtualMachines" || typeof item.name !== "string")) {
          throw new Error("Invalid cache");
        }
        if (data.fetchedAt > now() || now() - data.fetchedAt >= lifetime) {
          await rm(file, { force: true });
          return null;
        }
        return { value: data.value, fetchedAt: data.fetchedAt };
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code === "ENOENT") return null;
        throw failure(error);
      }
    },
    async write(key, entry, signal) {
      const file = fileFor(key);
      const temporary = `${file}.${randomUUID()}.tmp`;
      signal?.throwIfAborted();
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const json = JSON.stringify({ version: 1, key, fetchedAt: entry.fetchedAt, value: entry.value });
        if (Buffer.byteLength(json) > maxBytes) throw new Error("Oversized cache");
        const compressed = await compress(json);
        signal?.throwIfAborted();
        await writeFile(temporary, compressed, { flag: "wx", mode: 0o600, signal });
        signal?.throwIfAborted();
        await rename(temporary, file);
        const entries = await Promise.all((await readdir(directory)).filter((name) => filenamePattern.test(name)).map(async (name) => {
          const target = path.join(directory, name);
          try { return { target, modified: (await stat(target)).mtimeMs }; } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
          }
        }));
        const sorted = entries.filter(Boolean).sort((a, b) => b.modified - a.modified);
        await Promise.all(sorted.filter((entry, index) => index >= 4 || now() - entry.modified >= lifetime)
          .map((entry) => rm(entry.target, { force: true })));
      } catch (error) {
        await rm(temporary, { force: true });
        signal?.throwIfAborted();
        throw failure(error);
      }
    },
  };
}
