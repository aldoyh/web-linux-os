import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const mimes = {
  html: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  svg: 'image/svg+xml', css: 'text/css', js: 'application/javascript',
  ico: 'image/x-icon', json: 'application/json', txt: 'text/plain',
};

// PHP binary — override with PHP_BIN env if needed.
const phpBin = process.env.PHP_BIN || 'php';

/**
 * Handle a `.php` request by invoking the script in CLI mode.
 * api.php accepts a JSON envelope (method, query, body) as argv[1], so no
 * CGI plumbing is required and it works identically under `php -S`.
 */
function handlePhp(req, res, fp) {
  const parsed = url.parse(req.url);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const envelope = JSON.stringify({
      method: req.method,
      query: parsed.query || '',
      body,
    });
    const r = spawnSync(phpBin, [fp, envelope], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('PHP error: ' + r.error.message);
      return;
    }
    if (r.status !== 0) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(r.stderr || 'PHP process failed');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(r.stdout);
  });
}

http.createServer((req, res) => {
  let fp;
  try {
    fp = path.join(publicDir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  } catch {
    fp = path.join(publicDir, 'index.html');
  }

  // Route PHP scripts to the PHP runtime (single-file backend).
  if (path.extname(fp) === '.php') {
    handlePhp(req, res, fp);
    return;
  }

  try {
    const c = fs.readFileSync(fp);
    const ext = path.extname(fp).slice(1);
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    res.end(c);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3000, () => console.log('Desktopy OS server on :3000 (static + PHP backend)'));

export { publicDir };
