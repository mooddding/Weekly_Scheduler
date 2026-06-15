import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const publicDir = path.join(__dirname, "outputs");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const stateFile = path.join(dataDir, "scheduler-state.json");
const maxBodyBytes = 5 * 1024 * 1024;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

async function readState() {
  try {
    const raw = await readFile(stateFile, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dataDir, { recursive: true });
  const tempFile = `${stateFile}.tmp`;
  await writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await rename(tempFile, stateFile);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/weekly-scheduler.html" : url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
  });
  createReadStream(filePath)
    .on("error", () => {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not found");
    })
    .pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/state")) {
      if (request.method === "GET") {
        sendJson(response, 200, await readState());
        return;
      }
      if (request.method === "PUT") {
        const body = await readBody(request);
        const state = JSON.parse(body);
        await writeState(state);
        sendJson(response, 200, { ok: true });
        return;
      }
      response.writeHead(405, { Allow: "GET, PUT" });
      response.end("Method not allowed");
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end("Method not allowed");
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Weekly scheduler listening on http://localhost:${port}`);
  console.log(`State file: ${stateFile}`);
});
