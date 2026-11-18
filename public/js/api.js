/** 极简 API 客户端 */
async function request(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (raw) return res;
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error('服务器返回了无法解析的内容'), { status: res.status });
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent('aurum:unauthorized'));
    }
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  async download(path, filename) {
    const res = await request(path, { raw: true });
    if (!res.ok) {
      let message = '导出失败';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
