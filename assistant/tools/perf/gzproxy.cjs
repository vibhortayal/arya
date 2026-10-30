// Compressing reverse proxy that mimics deploy/Caddyfile (`encode gzip` on
// text types only, never on text/event-stream), so a local run measures
// transfer sizes the way production serves them.
// usage: node gzproxy.cjs [listenPort=8001] [targetPort=8000]
const http = require("http"), zlib = require("zlib");
const [lp, tp] = [Number(process.argv[2] || 8001), Number(process.argv[3] || 8000)];
const TEXT = /^(text\/html|text\/css|text\/javascript|application\/javascript|application\/json|application\/manifest\+json|image\/svg\+xml)/;
http.createServer((req, res) => {
  const up = http.request({ host: "127.0.0.1", port: tp, path: req.url, method: req.method,
    headers: { ...req.headers, "accept-encoding": "identity" } }, r => {
    const h = { ...r.headers };
    if (TEXT.test(h["content-type"] || "") && /gzip/.test(req.headers["accept-encoding"] || "")) {
      delete h["content-length"]; h["content-encoding"] = "gzip";
      res.writeHead(r.statusCode, h); r.pipe(zlib.createGzip()).pipe(res);
    } else { res.writeHead(r.statusCode, h); r.pipe(res); }
  });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(lp, () => console.log("proxy", lp, "->", tp));
