/** 端到端 API 自测：权限、三种抽奖、名额扣减、撤销、导出、账号管理 */
const BASE = process.env.BASE || 'http://127.0.0.1:5180/api';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${extra}`);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = '';
  }

  async req(path, method = 'GET', body) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (pair.startsWith('aurum_sid=')) this.cookie = pair;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers, text };
  }

  login(account, password) {
    return this.req('/auth/login', 'POST', { account, password });
  }
}

const stamp = Date.now().toString().slice(-6);

async function main() {
  console.log('\n[1] 认证');
  const admin = new Client('admin');
  const bad = await admin.login('admin', 'wrong-pass');
  ok('错误密码被拒绝', bad.status === 401, `got ${bad.status}`);
  const login = await admin.login('admin', 'admin123');
  ok('管理员登录成功', login.status === 200 && login.data.user.role === 'owner');
  ok('登录返回全部权限', login.data.user.permissions.length === 9);
  const me = await admin.req('/auth/me');
  ok('会话可用', me.status === 200 && me.data.user.account === 'admin');
  const anon = new Client('anon');
  ok('未登录访问被拒绝', (await anon.req('/activities')).status === 401);

  console.log('\n[2] 活动与奖项 CRUD');
  const created = await admin.req('/activities', 'POST', {
    name: `测试活动 ${stamp}`,
    subtitle: 'TEST EVENT',
    mode: 'quota',
    status: 'active',
    participantLimit: 0,
  });
  ok('创建活动', created.status === 201, JSON.stringify(created.data));
  const actId = created.data.activity.id;

  const badName = await admin.req('/activities', 'POST', { name: '' });
  ok('空名称校验', badName.status === 400);

  const prizes = await admin.req(`/activities/${actId}/prizes`, 'PUT', {
    prizes: [
      { name: '测试一等奖', level: '一等奖', quota: 1, weight: 10, color: '#E4C58C' },
      { name: '测试二等奖', level: '二等奖', quota: 3, weight: 20, color: '#C9A25F' },
    ],
  });
  ok('批量写入奖项', prizes.status === 200 && prizes.data.activity.prizes.length === 2);

  const dupPrize = await admin.req(`/activities/${actId}/prizes`, 'PUT', {
    prizes: [
      { name: '同名奖', level: '一等奖', quota: 1, weight: 1 },
      { name: '同名奖', level: '二等奖', quota: 1, weight: 1 },
    ],
  });
  ok('重复奖项名被拒绝', dupPrize.status === 400);

  console.log('\n[3] 名单抽奖（先选奖项，再从名单抽人，每抽一次减一个名额）');
  const detail = await admin.req(`/activities/${actId}`);
  const first = detail.data.activity.prizes.find((p) => p.name === '测试一等奖');
  const second = detail.data.activity.prizes.find((p) => p.name === '测试二等奖');
  ok('初始名额正确', first.remaining === 1 && second.remaining === 3);

  const emptyDraw = await admin.req(`/activities/${actId}/draw`, 'POST', { prizeId: first.id });
  ok('名单为空时被拒绝', emptyDraw.status === 409 && emptyDraw.data.code === 'roster_empty');

  const roster = await admin.req(`/activities/${actId}/roster`, 'PUT', {
    text: '测试员甲 13800001111\n测试员乙\n测试员丙',
  });
  ok('名单导入成功', roster.status === 200 && roster.data.summary.total === 3);

  const noPrize = await admin.req(`/activities/${actId}/draw`, 'POST', {});
  ok('未选奖项被拒绝', noPrize.status === 400);

  const draw1 = await admin.req(`/activities/${actId}/draw`, 'POST', { prizeId: first.id });
  ok('名单抽奖成功', draw1.status === 200 && draw1.data.hit === true);
  ok('抽出的是名单里的人', ['测试员甲', '测试员乙', '测试员丙'].includes(draw1.data.winner?.name));
  ok('抽后剩余 -1', draw1.data.record.remainingAfter === 0);
  ok('活动总剩余同步', draw1.data.activity.stats.totalRemaining === 3);
  ok('名单标记已中奖', draw1.data.roster.won === 1 && draw1.data.roster.left === 2);

  const draw2 = await admin.req(`/activities/${actId}/draw`, 'POST', { prizeId: first.id });
  ok('名额抽完被拒绝', draw2.status === 409 && draw2.data.code === 'quota_empty');

  const afterDraw = await admin.req(`/activities/${actId}`);
  ok('数据已持久化', afterDraw.data.activity.prizes.find((p) => p.id === first.id).remaining === 0);

  console.log('\n[4] 撤销记录返还名额');
  const undo = await admin.req(`/records/${draw1.data.record.id}`, 'DELETE');
  ok('撤销成功', undo.status === 200 && undo.data.refunded === true);
  const afterUndo = await admin.req(`/activities/${actId}`);
  ok('名额已返还', afterUndo.data.activity.prizes.find((p) => p.id === first.id).remaining === 1);

  console.log('\n[5] 概率抽奖');
  const prob = await admin.req('/activities', 'POST', {
    name: `概率测试 ${stamp}`,
    mode: 'probability',
    status: 'active',
    missWeight: 9999,
  });
  const probId = prob.data.activity.id;
  await admin.req(`/activities/${probId}/prizes`, 'PUT', {
    prizes: [{ name: '概率奖', level: '一等奖', quota: 5, weight: 0 }],
  });
  const miss = await admin.req(`/activities/${probId}/draw`, 'POST', {});
  ok('谢谢参与不扣名额', miss.status === 200 && miss.data.hit === false && miss.data.activity.stats.totalRemaining === 5);
  const probRec = miss.data.record;

  await admin.req(`/activities/${probId}`, 'PATCH', { missWeight: 0 });
  const hit = await admin.req(`/activities/${probId}/draw`, 'POST', {});
  ok('概率命中扣名额', hit.status === 200 && hit.data.hit === true && hit.data.record.remainingAfter === 4);

  const undoMiss = await admin.req(`/records/${probRec.id}`, 'DELETE');
  ok('撤销未中奖记录', undoMiss.status === 200 && undoMiss.data.refunded === false);

  console.log('\n[6] 抽奖码');
  const codeAct = await admin.req('/activities', 'POST', {
    name: `抽奖码测试 ${stamp}`,
    mode: 'code',
    status: 'active',
  });
  const codeId = codeAct.data.activity.id;
  await admin.req(`/activities/${codeId}/prizes`, 'PUT', {
    prizes: [{ name: '码奖', level: '大奖', quota: 2, weight: 10 }],
  });
  const gen = await admin.req(`/activities/${codeId}/codes`, 'POST', { count: 5 });
  ok('生成抽奖码', gen.status === 200 && gen.data.codes.length === 5);
  ok('未发放的码开奖被拦下', (await admin.req(`/activities/${codeId}/draw`, 'POST', { code: gen.data.codes[0].code })).status === 409);

  const issued1 = await admin.req(`/activities/${codeId}/codes/issue`, 'POST', { name: '码测试甲', phone: '13800001111' });
  ok('发码登记学员', issued1.status === 200 && Boolean(issued1.data.code?.code));
  const codes = [issued1.data.code.code];
  const issued2 = await admin.req(`/activities/${codeId}/codes/issue`, 'POST', { name: '码测试乙', phone: '13800002222' });
  codes.push(issued2.data.code.code);

  const use = await admin.req(`/activities/${codeId}/draw`, 'POST', { code: codes[0], phone: '13800001111' });
  ok('抽奖码开奖成功', use.status === 200 && use.data.hit === true);
  const replay = await admin.req(`/activities/${codeId}/draw`, 'POST', { code: codes[0], phone: '13800001111' });
  ok('抽奖码不可复用', replay.status === 409 && replay.data.code === 'code_used');
  const notFound = await admin.req(`/activities/${codeId}/draw`, 'POST', { code: 'AUR-ZZZZ' });
  ok('无效抽奖码被拒绝', notFound.status === 404);
  const lower = await admin.req(`/activities/${codeId}/draw`, 'POST', { code: codes[1].toLowerCase(), phone: '13800002222' });
  ok('抽奖码大小写不敏感', lower.status === 200);

  console.log('\n[7] 权限边界');
  const guest = new Client('guest');
  await guest.login('guest', 'guest123');
  ok('观察员可看活动', (await guest.req('/activities')).status === 200);
  ok('观察员不可抽奖', (await guest.req(`/activities/${actId}/draw`, 'POST', { prizeId: second.id })).status === 403);
  ok('观察员不可建活动', (await guest.req('/activities', 'POST', { name: 'x', mode: 'quota' })).status === 403);
  ok('观察员不可看账号', (await guest.req('/users')).status === 403);
  ok('观察员可看记录', (await guest.req('/records?limit=5')).status === 200);

  const ops = new Client('ops');
  await ops.login('ops', 'ops123');
  ok('执行员可抽奖', (await ops.req(`/activities/${actId}/draw`, 'POST', { prizeId: second.id, participant: '测试员乙' })).status === 200);
  ok('执行员不可导出', (await ops.req('/records/export')).status === 403);

  const audit = new Client('audit');
  await audit.login('audit', 'audit123');
  ok('审核员不可抽奖', (await audit.req(`/activities/${actId}/draw`, 'POST', { prizeId: second.id })).status === 403);
  const auditList = await audit.req(`/records?activityId=${actId}&limit=5`);
  ok('审核员可看记录', auditList.status === 200 && auditList.data.total >= 1);
  ok('审核员可撤销', (await audit.req(`/records/${auditList.data.records[0].id}`, 'DELETE')).status === 200);

  console.log('\n[8] 账号与权限管理');
  const newUser = await admin.req('/users', 'POST', {
    name: '测试账号',
    account: `tester${stamp}`,
    password: 'test123',
    role: 'viewer',
  });
  ok('创建账号', newUser.status === 201 && newUser.data.user.permissions.length === 2);
  const dupUser = await admin.req('/users', 'POST', {
    name: '重复', account: `tester${stamp}`, password: 'test123', role: 'viewer',
  });
  ok('账号重复被拒绝', dupUser.status === 400);

  const userId = newUser.data.user.id;
  const permEdit = await admin.req(`/users/${userId}`, 'PATCH', {
    permissions: ['activity.view', 'draw.execute', 'record.view'],
  });
  ok('单独调整权限', permEdit.status === 200 && permEdit.data.user.permissions.includes('draw.execute'));

  const tester = new Client('tester');
  await tester.login(`tester${stamp}`, 'test123');
  ok('新账号可登录', (await tester.req('/auth/me')).status === 200);
  const pwd = await tester.req('/auth/password', 'PATCH', { oldPassword: 'test123', newPassword: 'test1234' });
  ok('新账号改掉初始密码', pwd.status === 200);
  ok('新账号按勾选权限抽奖', (await tester.req(`/activities/${actId}/draw`, 'POST', { prizeId: second.id })).status === 200);

  const disable = await admin.req(`/users/${userId}`, 'PATCH', { enabled: false });
  ok('停用账号', disable.status === 200 && disable.data.user.enabled === false);
  ok('停用后会话失效', (await tester.req('/auth/me')).status === 401);
  ok('停用后无法登录', (await new Client('t2').login(`tester${stamp}`, 'test1234')).status === 401);

  const self = await admin.req(`/users/${login.data.user.id}`, 'PATCH', { role: 'viewer' });
  ok('不能改自己的角色', self.status === 400);
  const selfDel = await admin.req(`/users/${login.data.user.id}`, 'DELETE');
  ok('不能删除自己', selfDel.status === 400);
  await admin.req(`/users/${userId}`, 'DELETE');
  ok('删除测试账号', (await admin.req(`/users/${userId}`, 'DELETE')).status === 404);

  console.log('\n[9] 导出与统计');
  const csv = await admin.req('/records/export');
  ok('CSV 导出', csv.status === 200 && String(csv.headers.get('content-type')).includes('text/csv'));
  const csvText = String(csv.text).replace(/^\uFEFF/, '');
  ok('CSV 表头正确', csvText.startsWith('时间,活动,抽奖方式,奖项,等级,参与者,手机号,抽奖码,操作人,抽后剩余'));
  const stats = await admin.req('/stats');
  ok('统计接口', stats.status === 200 && typeof stats.data.quota.remaining === 'number');

  console.log('\n[10] 清理');
  await admin.req(`/activities/${actId}`, 'DELETE');
  await admin.req(`/activities/${probId}`, 'DELETE');
  await admin.req(`/activities/${codeId}`, 'DELETE');
  const gone = await admin.req(`/activities/${actId}`);
  ok('删除活动级联记录', gone.status === 404);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (failures.length) console.log(failures.join('\n'));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
