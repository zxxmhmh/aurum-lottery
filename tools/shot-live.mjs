/**
 * 无头 Edge 截图 + 控制台错误采集
 * 用法：node tools/shot.mjs --url http://127.0.0.1:5180 --out shots/login.png [--login] [--eval "js"] [--wait 800]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const url = opt('url', 'http://127.0.0.1:5180');
const out = opt('out', 'shots/shot.png');
const width = Number(opt('width', '1440'));
const height = Number(opt('height', '900'));
const dpr = Number(opt('dpr', '1.5'));
const waitMs = Number(opt('wait', '900'));
const fullPage = flag('full');
const login = flag('login');
const evalScript = opt('eval', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEndpoint() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.logs = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        this.logs.push(`[${msg.params.type}] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`.trim());
      }
      if (msg.method === 'Log.entryAdded') {
        this.logs.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`);
      }
      const handlers = this.listeners.get(msg.method);
      if (handlers) handlers.forEach((fn) => fn(msg.params));
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 20000);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  evaluate(expression, awaitPromise = true) {
    return this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }).then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '脚本执行失败');
      return r.result?.value;
    });
  }
}

async function main() {
  const userDataDir = path.join(os.tmpdir(), `aurum-edge-${Date.now()}`);
  const proc = spawn(
    EDGE,
    [
      '--window-size=1440,1000', '--start-maximized',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  let exitCode = 0;
  try {
    await waitEndpoint();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('找不到页面目标');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    const ua = opt('ua', '');
    if (ua) {
      await cdp.send('Network.setUserAgentOverride', {
        userAgent: ua,
        platform: opt('platform', 'iPhone'),
      });
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: false,
    });

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(8000)]);

    if (login) {
      const account = opt('account', 'admin');
      const password = opt('password', 'admin123');
      const ok = await cdp.evaluate(`
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: ${JSON.stringify(account)}, password: ${JSON.stringify(password)} })
        }).then(r => r.ok).catch(() => false)
      `);
      if (!ok) throw new Error('登录失败');
      await cdp.evaluate(`location.reload()`);
      await sleep(1400);
    }

    if (evalScript) {
      const evalResult = await cdp.evaluate(evalScript);
      if (evalResult !== undefined && evalResult !== null) console.log('eval:', evalResult);
    }

    await sleep(waitMs);

    if (fullPage) {
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const h = Math.min(4000, Math.ceil(metrics.cssContentSize.height));
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: h,
        deviceScaleFactor: dpr,
        mobile: false,
      });
      await sleep(320);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    const file = path.resolve(process.cwd(), out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

    const title = await cdp.evaluate('document.title');
    console.log(`saved ${out} (${width}x${fullPage ? 'full' : height}) title="${title}"`);
    if (cdp.logs.length) {
      console.log('--- console ---');
      console.log(cdp.logs.slice(-40).join('\n'));
    } else {
      console.log('console: clean');
    }
    ws.close();
  } catch (err) {
    exitCode = 1;
    console.error('ERROR:', err.message);
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(exitCode), 300);
  }
}

main();
