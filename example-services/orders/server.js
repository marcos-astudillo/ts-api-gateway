/**
 * Example "Orders" microservice.
 *
 * A minimal Express.js-style service (raw http) simulating a real upstream.
 * Demonstrates canary traffic splitting — run two instances on different ports,
 * register them as stable + canary in the gateway, then set FEATURE_CANARY_RELEASES=true.
 *
 * Endpoints:
 *   GET  /orders          → list orders
 *   GET  /orders/:id      → get order by ID
 *   POST /orders          → create order
 *
 * Start (stable):
 *   node example-services/orders/server.js
 *
 * Start (canary — different port + version):
 *   PORT=8083 VERSION=v2-canary node example-services/orders/server.js
 */
'use strict';

const http = require('http');

const PORT = parseInt(process.env.PORT || '8082', 10);
const VERSION = process.env.VERSION || 'v1';

// ─── Simulated latency (canary can be faster/slower to test degraded detection) ─
const LATENCY_MS = parseInt(process.env.LATENCY_MS || '0', 10);

// ─── In-memory data store ─────────────────────────────────────
let nextId = 100;
const orders = [
  { id: nextId++, userId: 1, product: 'Widget A', qty: 2, status: 'shipped' },
  { id: nextId++, userId: 2, product: 'Widget B', qty: 1, status: 'pending' },
];

// ─── Utility ──────────────────────────────────────────────────
function sendJson(res, status, body) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('x-service-version', VERSION);
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function withLatency(fn) {
  if (LATENCY_MS > 0) {
    setTimeout(fn, LATENCY_MS);
  } else {
    fn();
  }
}

// ─── Simple router ────────────────────────────────────────────
function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // HEAD / — upstream health probe
  if (req.method === 'HEAD' && pathname === '/') {
    withLatency(() => {
      res.setHeader('x-service-version', VERSION);
      res.writeHead(200);
      res.end();
    });
    return;
  }

  withLatency(() => {
    // GET /orders
    if (req.method === 'GET' && pathname === '/orders') {
      sendJson(res, 200, { data: orders, version: VERSION });
      return;
    }

    // GET /orders/:id
    const idMatch = pathname.match(/^\/orders\/(\d+)$/);
    if (req.method === 'GET' && idMatch) {
      const order = orders.find((o) => o.id === parseInt(idMatch[1], 10));
      if (!order) {
        sendJson(res, 404, { error: 'Order not found' });
      } else {
        sendJson(res, 200, { data: order, version: VERSION });
      }
      return;
    }

    // POST /orders
    if (req.method === 'POST' && pathname === '/orders') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (!payload.userId || !payload.product) {
            sendJson(res, 400, { error: 'userId and product are required' });
            return;
          }
          const order = {
            id: nextId++,
            userId: payload.userId,
            product: payload.product,
            qty: payload.qty || 1,
            status: 'pending',
          };
          orders.push(order);
          sendJson(res, 201, { data: order, version: VERSION });
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' });
        }
      });
      return;
    }

    // 404 fallback
    sendJson(res, 404, { error: 'Not found', path: pathname });
  });
}

// ─── Start server ─────────────────────────────────────────────
const server = http.createServer(router);
server.listen(PORT, () => {
  console.log(`[orders-service ${VERSION}] listening on http://localhost:${PORT} (latency: ${LATENCY_MS}ms)`);
});

process.on('SIGTERM', () => { server.close(); });
process.on('SIGINT',  () => { server.close(); });
