/* Static server for the exported Expo web build (mobile/dist).
   SPA fallback to index.html. Paths resolved from __dirname (no cwd dependency). */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "dist");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8757;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    let filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback for client-side routes
        return fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
          if (e2) {
            res.writeHead(404);
            return res.end("not found");
          }
          res.writeHead(200, { "Content-Type": TYPES[".html"] });
          res.end(html);
        });
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log("OfficeFC web preview on http://localhost:" + PORT));
