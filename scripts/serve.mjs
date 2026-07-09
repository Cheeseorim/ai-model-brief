import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 3000);
const root = new URL("../dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

createServer(async (request, response) => {
  try {
    let path = normalize(join(root, decodeURIComponent(request.url.split("?")[0])));
    if (!path.startsWith(root)) throw new Error("Forbidden");
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    response.setHeader("content-type", types[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
