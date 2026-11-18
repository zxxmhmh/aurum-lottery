import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadDb, saveNow, startAutoBackup, db, ROOT } from './db.js';
import { verifyPassword } from './password.js';
import { handle } from './routes.js';
import { authenticate, parseCookies, COOKIE_NAME } from './auth.js';
import { HttpError } from './util.js';

const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error('[api]', err);
  sendJson(res, status, {
    error: err instanceof HttpError ? err.message : '服务器内部错误',
    code: err?.code || 'internal_error',
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new HttpError(413, '请求体过大', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw new HttpError(415, '请求格式必须为 JSON', 'unsupported_media_type');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    throw new HttpError(400, '请求内容不是合法的 JSON', 'bad_json');
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  // 已下线的旧地址：直接 404，不再回退到后台首页
  const RETIRED = new Set(['/m', '/m/', '/staff', '/staff/', '/tv', '/tv/']);
  if (RETIRED.has(rel)) {
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>页面不存在</title>'
      + '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
      + 'background:#f5efe4;color:#6b4515;font:16px/1.8 -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;text-align:center">'
      + '<div><div style="font-size:22px;font-weight:600;margin-bottom:8px">这个地址已经停用</div>'
      + '<div style="color:#9a8c74">请联系管理员获取新的访问地址</div></div></body>',
    );
    return;
  }
  if (rel === '/redeem' || rel === '/redeem/') rel = '/redeem.html';
  if (rel === '/fama' || rel === '/fama/') rel = '/m.html';
  if (rel === '/ua' || rel === '/ua/') rel = '/ua.html';
  if (rel === '/stage-lite' || rel === '/stage-lite/' || rel === '/tv' || rel === '/tv/') rel = '/stage-lite.html';
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: '禁止访问', code: 'forbidden' });
    return;
  }
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      if (!path.extname(filePath)) {
        // SPA 回退：未知路径统一交给前端路由
        const index = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(index, (err, buf) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': MIME['.html'],
            'Cache-Control': 'no-cache',
            ...SECURITY_HEADERS,
          });
          res.end(buf);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveUploads(req, res, pathname, prefix, subdir) {
  const name = decodeURIComponent(pathname.slice(prefix.length));
  if (!/^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(name)) {
    sendJson(res, 404, { error: '图片不存在', code: 'not_found' });
    return;
  }
  const filePath = path.join(ROOT, 'data', subdir, name);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendJson(res, 404, { error: '图片不存在', code: 'not_found' });
      return;
    }
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname = '/';
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      const staticDir = pathname.startsWith('/uploads/')
        ? { prefix: '/uploads/', subdir: 'uploads' }
        : pathname.startsWith('/cards/')
          ? { prefix: '/cards/', subdir: 'cards' }
          : null;
      if (staticDir) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: '方法不被支持', code: 'method_not_allowed' });
          return;
        }
        serveUploads(req, res, pathname, staticDir.prefix, staticDir.subdir);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '方法不被支持', code: 'method_not_allowed' });
        return;
      }
      serveStatic(req, res, pathname);
      return;
    }

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !sameOrigin(req)) {
      throw new HttpError(403, '跨站请求被拒绝', 'bad_origin');
    }

    const body = await readJsonBody(req);
    const cookies = parseCookies(req.headers.cookie || '');
    const { user, token } = authenticate(req);

    const ctx = {
      req,
      res,
      url,
      query: url.searchParams,
      body,
      params: {},
      user,
      token,
      status: 200,
      cookies: [],
      setCookie(value) {
        this.cookies.push(value);
      },
      sendFile(content, filename) {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          ...SECURITY_HEADERS,
        });
        res.end(content);
      },
    };

    void COOKIE_NAME;

    // 初始密码未改：除「看自己/改密码/退出」和学员公开接口外一律拦住
    if (user?.mustChangePassword) {
      const allowed = ['/api/auth/me', '/api/auth/password', '/api/auth/logout'];
      if (!allowed.includes(pathname) && !pathname.startsWith('/api/public/')) {
        sendJson(res, 403, { error: '请先修改初始密码', code: 'password_change_required' });
        return;
      }
    }

    const result = await handle(ctx, req.method, pathname);

    if (res.writableEnded) return;
    if (ctx.cookies.length) res.setHeader('Set-Cookie', ctx.cookies);
    if (result === null || result === undefined) {
      sendJson(res, ctx.status || 200, { ok: true });
      return;
    }
    sendJson(res, ctx.status || 200, result);
  } catch (err) {
    if (res.writableEnded) return;
    sendError(res, err);
  } finally {
    if (pathname.startsWith('/api/')) {
      const ms = Date.now() - started;
      if (ms > 500) console.log(`[slow] ${req.method} ${pathname} ${ms}ms`);
    }
  }
});

loadDb();
startAutoBackup();

// 只检查四个演示账号，别对全量账号做 scrypt（账号一多启动会明显变慢）
const DEMO_PASSWORDS = { admin: 'admin123', ops: 'ops123', audit: 'audit123', guest: 'guest123' };
const weak = [];
for (const [account, guess] of Object.entries(DEMO_PASSWORDS)) {
  const user = db.users.find((u) => u.account === account);
  if (user?.salt && user?.hash && verifyPassword(guess, user.salt, user.hash)) {
    weak.push(`${account} / ${guess}`);
  }
}
if (weak.length) {
  console.warn('');
  console.warn('  ⚠ 以下账号还在用演示密码，上线前请立刻改掉：');
  for (const item of weak) console.warn('    ·', item);
  console.warn('    改法：账号与权限 → 编辑账号 → 重置密码');
  console.warn('');
}

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('');
  console.log('  智学内部抽奖系统');
  console.log(`  已启动 → http://${shown}:${PORT}`);
  console.log('  后台 http://' + shown + ':' + PORT + '　学员页 /redeem');
  console.log('');
});

function shutdown() {
  console.log('\n[server] 正在保存数据并退出…');
  saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
