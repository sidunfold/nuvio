'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = {'/manifest.json': 'application/json', '/providers/pencurimovie.js': 'application/javascript'};
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!allowed[pathname]) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, pathname), (err, data) => {
    if (err) { res.writeHead(500); return res.end('File unavailable'); }
    res.writeHead(200, {'Content-Type': allowed[pathname], 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => console.log('Provider manifest: http://localhost:' + port + '/manifest.json'));
