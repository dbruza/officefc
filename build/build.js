/* OfficeFC build — assemble the multi-file design prototype into a single
   self-contained, deployable OfficeFC.html (no cross-file fetches → runs from
   file:// or any static host). JSX is precompiled to plain JS at build time, so
   the shipped file loads only React + ReactDOM (no in-browser Babel runtime).
   Source of truth is prototype/officefc/. */
const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "officefc");
const read = (p) => fs.readFileSync(p, "utf8");

// 1) reuse the prototype's <head> (fonts + the full design-system <style> block)
const protoHtml = read(path.join(SRC, "OfficeFC.html"));
const head = protoHtml.slice(0, protoHtml.indexOf("</head>") + "</head>".length);

// 2) gather app source (data engine as plain JS; UI + screens + shell as JSX)
const dataJs = read(path.join(SRC, "app", "data.js"));
const jsx = [
  read(path.join(SRC, "app", "ui.jsx")),
  read(path.join(SRC, "app", "screens-main.jsx")),
  read(path.join(SRC, "app", "screens-detail.jsx")),
  read(path.join(SRC, "app", "screens-log.jsx")),
  read(path.join(__dirname, "app-shell.jsx")), // tweak-free shell (replaces app/app.jsx)
].join("\n\n/* ───────────────────────────────────────────────────────── */\n\n");

// 3) precompile JSX -> plain JS (React.createElement). No runtime Babel shipped.
const compiled = Babel.transform(jsx, {
  presets: ["react"],
  compact: false,
  comments: true,
}).code;

const cdn = [
  '  <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>',
  '  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>',
].join("\n");

const out =
  head +
  "\n<body>\n" +
  '  <div id="root"></div>\n\n' +
  cdn +
  "\n\n" +
  "  <!-- OfficeFC data engine (deterministic mock league) -->\n" +
  "  <script>\n" +
  dataJs +
  "\n  </script>\n\n" +
  "  <!-- OfficeFC UI + screens + app shell (JSX precompiled at build time) -->\n" +
  "  <script>\n" +
  compiled +
  "\n  </script>\n" +
  "</body>\n</html>\n";

const dest = path.join(ROOT, "OfficeFC.html");
fs.writeFileSync(dest, out);
console.log("Wrote " + dest + " (" + out.length + " bytes)");
