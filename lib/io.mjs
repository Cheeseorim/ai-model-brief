import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(path) {
  return path instanceof URL ? fileURLToPath(path) : path;
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(normalizePath(path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  const target = normalizePath(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}
