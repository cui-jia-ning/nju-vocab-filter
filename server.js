// 静态文件预览服务器：支持 --host / --port（或 -p）参数，缺省 127.0.0.1:7100
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argOf(names, dflt) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1 && args[i + 1]) return args[i + 1];
  }
  return dflt;
}
const host = argOf(['--host', '-H'], '127.0.0.1');
const port = parseInt(argOf(['--port', '-p'], process.env.PORT || '7100'), 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(__dirname, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(port, host, () => console.log(`预览地址: http://${host}:${port}/`));
