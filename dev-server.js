const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // CORS headers for local development convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
  const pathname = urlObj.pathname;

  // Handle API routes: /api/<name>
  if (pathname.startsWith('/api/')) {
    const apiName = pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
    const apiPath = path.join(ROOT, 'api', `${apiName}.js`);

    if (fs.existsSync(apiPath)) {
      try {
        // Populate req.query like Vercel serverless environment
        req.query = Object.fromEntries(urlObj.searchParams.entries());

        // Parse JSON body if present
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            req.body = raw ? JSON.parse(raw) : {};
          } catch (e) {
            req.body = raw;
          }
        }

        delete require.cache[require.resolve(apiPath)];
        const handler = require(apiPath);
        return await handler(req, res);
      } catch (err) {
        console.error(`Error in API handler ${apiName}:`, err);
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    } else {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: `API route ${apiName} not found` }));
    }
  }

  // Handle static files
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', contentType);
    res.end(data);
  } catch (err) {
    res.statusCode = 500;
    res.end('Error loading file: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

