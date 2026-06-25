#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT       = parseInt(process.env.PORT       || '8989',    10);
const TARGET     = (process.env.TARGET_URL          || 'https://llm.local').replace(/\/$/, '');
const INSECURE   = process.env.UPSTREAM_INSECURE   === 'true';
const LOG_BODY   = process.env.LOG_BODY            === 'true';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '300000', 10); // 5 min default — LLMs are slow

const target     = new URL(TARGET);
const proto      = target.protocol === 'https:' ? https : http;
const upPort     = target.port ? parseInt(target.port, 10) : (target.protocol === 'https:' ? 443 : 80);
const basePath   = target.pathname.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(level, msg) {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Core transformation:
//   tools[N].function.parameters  →  tools[N].function.arguments
// The apigate erroneously requires "arguments" (response schema field) instead
// of "parameters" (request schema field) in the tool definitions.
// ---------------------------------------------------------------------------
function transformTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(tool => {
    if (
      tool &&
      tool.type === 'function' &&
      tool.function &&
      Object.prototype.hasOwnProperty.call(tool.function, 'parameters')
    ) {
      const { parameters, ...fn } = tool.function;
      return { ...tool, function: { ...fn, arguments: parameters } };
    }
    return tool;
  });
}

// ---------------------------------------------------------------------------
// Read full request body into a Buffer (needed to parse + rewrite JSON).
// Only called for JSON content-type requests.
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  c => chunks.push(c));
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const id = Math.random().toString(36).slice(2, 8);
  log('info', `[${id}] ← ${req.method} ${req.url}`);

  try {
    const isJson  = (req.headers['content-type'] || '').includes('application/json');
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const upPath  = basePath + req.url;

    // Build upstream headers — shallow copy, override host, drop hop-by-hop
    const headers = Object.assign({}, req.headers, { host: target.host });
    delete headers['transfer-encoding'];

    // -----------------------------------------------------------------------
    // Transform body (JSON only)
    // -----------------------------------------------------------------------
    let bodyBuf;
    let rewrote = false;

    if (hasBody && isJson) {
      const raw = await readBody(req);
      if (raw.length) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.tools)) {
            const rewritten = transformTools(parsed.tools);
            rewrote = JSON.stringify(rewritten) !== JSON.stringify(parsed.tools);
            bodyBuf = Buffer.from(
              JSON.stringify(rewrote ? { ...parsed, tools: rewritten } : parsed),
              'utf8'
            );
          } else {
            bodyBuf = raw;
          }
          if (LOG_BODY) log('debug', `[${id}] outgoing body: ${bodyBuf.toString('utf8')}`);
        } catch {
          // Unparseable JSON — forward as-is
          bodyBuf = raw;
        }
      } else {
        bodyBuf = raw;
      }
      headers['content-length'] = String(bodyBuf.length);
    }

    log('info', `[${id}] → ${target.host}${upPath}${rewrote ? ' [tools: parameters→arguments]' : ''}`);

    // -----------------------------------------------------------------------
    // Forward to upstream
    // -----------------------------------------------------------------------
    const upReq = proto.request(
      {
        hostname: target.hostname,
        port:     upPort,
        path:     upPath,
        method:   req.method,
        headers,
        rejectUnauthorized: !INSECURE,
      },
      upRes => {
        log('info', `[${id}] ↓ ${upRes.statusCode} (${upRes.headers['content-type'] || '—'})`);
        // Relay status + headers verbatim, then stream the body.
        // This preserves SSE / chunked transfer without buffering.
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res, { end: true });
        upRes.on('end', () => log('info', `[${id}] done`));
      }
    );

    upReq.setTimeout(TIMEOUT_MS, () => {
      log('error', `[${id}] upstream timeout after ${TIMEOUT_MS} ms`);
      upReq.destroy(new Error(`upstream timeout after ${TIMEOUT_MS} ms`));
    });

    upReq.on('error', err => {
      log('error', `[${id}] upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
      }
    });

    if (bodyBuf !== undefined) {
      // JSON path: body already buffered and transformed
      upReq.end(bodyBuf);
    } else {
      // Non-JSON / GET / HEAD: stream the raw body (or no body)
      req.pipe(upReq, { end: true });
    }

  } catch (err) {
    log('error', `[${id}] internal: ${err.message}`);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log('info', `proxy-llm listening on http://0.0.0.0:${PORT}`);
  log('info', `forwarding to: ${TARGET}`);
  if (INSECURE) log('warn', 'upstream TLS verification DISABLED');
});

server.on('error', err => {
  log('error', `server: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
function shutdown() { server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
