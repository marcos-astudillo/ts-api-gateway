/**
 * Example "Users" microservice.
 *
 * A minimal Express.js service that simulates a real upstream.
 * Used to demonstrate the API Gateway routing, canary splitting,
 * health monitoring, and caching features end-to-end.
 *
 * Endpoints:
 *   GET  /users          → list all users
 *   GET  /users/:id      → get user by ID
 *   POST /users          → create a user
 *
 * Start:
 *   node example-services/users/server.js
 *   PORT=8081 node example-services/users/server.js
 */
'use strict';

const http = require('http');

const PORT = parseInt(process.env.PORT || '8081', 10);
const VERSION = process.env.VERSION || 'v1';

// ─── In-memory data store ─────────────────────────────────────
let nextId = 1;
const users = [
  { id: nextId++, name: 'Alice', email: 'alice@example.com', role: 'admin' },
  { id: nextId++, name: 'Bob',   email: 'bob@example.com',   role: 'user'  },
];

// ─── Simple router ────────────────────────────────────────────
function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Inject service version header so callers can distinguish stable vs canary
  res.setHeader('x-service-version', VERSION);
  res.setHeader('content-type', 'application/json');

  // HEAD / — used by the gateway upstream health probe
  if (req.method === 'HEAD' && pathname === '/') {
    res.writeHead(200);
    res.end();
    return;
  }

  // GET /users
  if (req.method === 'GET' && pathname === '/users') {
    res.writeHead(200);
    res.end(JSON.stringify({ data: users, version: VERSION }));
    return;
  }

  // GET /users/:id
  const idMatch = pathname.match(/^\/users\/(\d+)$/);
  if (req.method === 'GET' && idMatch) {
    const user = users.find((u) => u.id === parseInt(idMatch[1], 10));
    if (!user) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'User not found' }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ data: user, version: VERSION }));
    }
    return;
  }

  // POST /users
  if (req.method === 'POST' && pathname === '/users') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.name || !payload.email) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'name and email are required' }));
          return;
        }
        const user = { id: nextId++, name: payload.name, email: payload.email, role: payload.role || 'user' };
        users.push(user);
        res.writeHead(201);
        res.end(JSON.stringify({ data: user, version: VERSION }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 404 fallback
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
}

// ─── Start server ─────────────────────────────────────────────
const server = http.createServer(router);
server.listen(PORT, () => {
  console.log(`[users-service ${VERSION}] listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); });
process.on('SIGINT',  () => { server.close(); });
