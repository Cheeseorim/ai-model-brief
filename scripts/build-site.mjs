import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(new URL("data/", output), { recursive: true });
await mkdir(new URL("config/", output), { recursive: true });
await cp(new URL("public/", root), output, { recursive: true });
for (const file of ["events.json", "state.json", "runs.json"]) {
  await cp(new URL(`data/${file}`, root), new URL(`data/${file}`, output));
}
await cp(new URL("config/pricing.json", root), new URL("config/pricing.json", output));
console.log("Built static dashboard in dist/");
