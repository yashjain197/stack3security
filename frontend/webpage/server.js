import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/config.json") {
    response.writeHead(200, {
      "Content-Type": contentTypes[".json"],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify({ apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:8000" }));
    return;
  }
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid path");
    return;
  }
  const requestedFile = resolve(root, `.${decodedPathname}`);
  const isInsideRoot = requestedFile === root || requestedFile.startsWith(`${root}${sep}`);

  if (!isInsideRoot) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = pathname === "/" ? resolve(root, "index.html") : requestedFile;
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT" && !extname(pathname)) {
      try {
        const body = await readFile(resolve(root, "index.html"));
        response.writeHead(200, {
          "Content-Type": contentTypes[".html"],
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        response.end(body);
        return;
      } catch (fallbackError) {
        console.error("Unable to load webpage entry point:", fallbackError);
        response.writeHead(500);
        response.end("Unable to load webpage");
        return;
      }
    }

    console.error(`Unable to serve ${pathname}:`, error);
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Unable to serve file");
  }
}).listen(port, host, () => {
  console.log(`Stack3 Security demo available at http://localhost:${port}`);
});
