// Local-only fixture server. No dependencies, no directory traversal or file listing.
const http = require('node:http');
const fs = require('node:fs');
const routes = {
  '/tests/browser.html': ['tests/browser.html', 'text/html'],
  '/tests/browser.js': ['tests/browser.js', 'text/javascript'],
  '/core.js': ['core.js', 'text/javascript'],
  '/content.js': ['content.js', 'text/javascript'],
  '/diary.js': ['diary.js', 'text/javascript'],
  '/average.js': ['average.js', 'text/javascript'],
};
http.createServer((req, res) => {
  const route = routes[req.url];
  if (!route) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': route[1] });
  res.end(fs.readFileSync(route[0]));
}).listen(8765, '127.0.0.1', () => console.log('Open http://127.0.0.1:8765/tests/browser.html'));
