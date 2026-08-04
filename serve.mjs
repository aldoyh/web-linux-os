import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const mimes = { html: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', css: 'text/css', js: 'application/javascript', ico: 'image/x-icon', json: 'application/json' };

http.createServer((req, res) => {
  let fp = path.join(publicDir, req.url === '/' ? 'index.html' : req.url);
  try {
    const c = fs.readFileSync(fp);
    const ext = path.extname(fp).slice(1);
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    res.end(c);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3000, () => console.log('Server on :3000'));
