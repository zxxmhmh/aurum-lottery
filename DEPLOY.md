# 部署上线清单

> 面向windows 单机部署。服务是**单进程 + 内存状态 + JSON 落盘**，部署的核心就是：只跑一个进程、数据目录备份好、对外地址填对。

---

## 0. 五分钟上线版

```bat
:: 1. 确认 Node 版本（建议 20 或 24）
node -v

:: 2. 启动
双击 启动抽奖系统.bat

:: 3. 浏览器打开 http://127.0.0.1:5180 ，登录 admin / admin123
```

然后**立刻做下面第 1、2 条**，再开始发码。

---

## 1. 改掉演示密码（必做）

初始四个账号都在用演示密码：

| 账号 | 初始密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 超级管理员 |
| ops | ops123 | 抽奖执行 |
| audit | audit123 | 审核员 |
| guest | guest123 | 观察员 |

改法：**账号与权限 → 编辑账号 → 重置密码**（至少 6 位）。

- 用不到的账号直接删掉，只留需要的人
- 建议一校区一个账号（`ops-hd`、`ops-cy`…），发码记录里能看出是谁发的
- 服务启动时如果检测到演示密码还在用，控制台会打印红色警告

## 2. 填对外地址（必做，否则二维码是废的）

后台 → 活动与奖项 → 抽奖码 → **对外地址**，填学员真正能访问的地址，例如：

```
https://lucky.example.com
```

- 不填就默认用「你当前访问的地址」——如果你从 `127.0.0.1` 打开，二维码会印成 `http://127.0.0.1:5180/redeem`，学员扫了打不开
- 填完点保存，二维码、导出的名单链接都会跟着变
- **印海报前先拿手机扫一次**

## 3. 域名与 HTTPS（强烈建议）

微信内置浏览器对 `http://` 有限制（部分机型无法保存图片、剪贴板受限），建议反代一个 HTTPS。

**Windows 最省事：Caddy**（自动申请证书）

```
Caddyfile：
lucky.example.com {
    reverse_proxy 127.0.0.1:5180
}
```

```bat
caddy run
```

nginx 等价配置：

```nginx
server {
  listen 443 ssl;
  server_name lucky.example.com;
  ssl_certificate     /path/fullchain.pem;
  ssl_certificate_key /path/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:5180;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> 走反代时把服务保持在 `127.0.0.1` 更安全：`HOST=127.0.0.1 PORT=5180 node server/index.js`

## 4. 端口与防火墙

- 默认端口 `5180`，可用环境变量改：`set PORT=8080`
- 默认监听 `0.0.0.0`（局域网可访问）。只想本机用就设 `HOST=127.0.0.1`
- Windows 防火墙放行：`netsh advfirewall firewall add rule name="lottery" dir=in action=allow protocol=TCP localport=5180`

## 5. 开机自启 / 崩溃重启

**方式 A（最简单）**：双击 `启动抽奖系统.bat`，它自带崩溃后 5 秒自动重启。

**方式 B（任务计划程序）**：

1. 任务计划程序 → 创建任务
2. 触发器：登录时 / 开机时
3. 操作：启动程序 `node`，参数 `server/index.js`，起始于 `<项目根目录>`（例如 `D:\aurum-lottery`）
4. 勾选「不管用户是否登录都要运行」

**方式 C（Linux）**：`pm2 start server/index.js --name lottery`，**必须 instances: 1**（不要 cluster）。

> ⚠️ 绝对不能同时跑两个进程指向同一个 `data/db.json`：状态在内存里，两个进程会各写各的，数据会错乱。

## 6. 数据与备份

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `data/db.json` | 全部业务数据 | 唯一的真数据源 |
| `data/backups/` | 每 6 小时自动快照（保留 30 份） | 启动时若近 12 小时没备份会先备一份 |
| `data/trash/` | 删除活动时的整场快照（保留 30 份） | 后台「回收站」可一键恢复 |
| `data/uploads/` | 奖项样品图 | 有图就跟着备份 |
| `data/cards/` | 微信保存领奖图的临时文件 | 自动清理两天前 |

### 三层备份

| 层 | 频率 | 位置 | 覆盖 | 保留 |
| --- | --- | --- | --- | --- |
| 应用内快照 | 每 6 小时 | `data/backups/` | `db.json` | 30 份 |
| **服务器打包** | **每小时** | `/srv/lottery-backups/` | `db.json` + `uploads/` | 7 天 |
| **本机冷备** | 每天 21:30 | `E:\lottery-backups\` | 同上（整包） | 30 天 |

服务器打包由系统 cron 触发（`/etc/cron.d/lottery-backup` → `/usr/local/bin/lottery-backup.sh`），脚本会校验 tar 可读、体积不小于 20KB，失败不落盘并记 `/var/log/lottery-backup.log`。

本机冷备由 Windows 计划任务 `LotteryBackupPull` 拉取（`tools/pull-backups.ps1`），安装：`powershell -File tools\install-backup-task.ps1`。

### 后台手动备份

后台「总览」右侧有 **数据备份** 卡片（需要 `backup.manage` 权限，默认只有超级管理员）：

- **立即备份**：在 `data/backups/` 生成一份 `db-…-manual.json`
- **下载最新**：把最新快照下载到本机（约 170KB）

### 恢复演练（建议每季度做一次）

```bash
# 在服务器上：取最新整包，解到一个临时目录并起一个临时实例验证
RT=/tmp/rt; rm -rf $RT; mkdir -p $RT/data
cp -r /srv/lottery/server /srv/lottery/public /srv/lottery/package.json $RT/
tar -xzf "$(ls -t /srv/lottery-backups/lottery-*.tar.gz | head -1)" -C $RT/data
cd $RT && PORT=5199 HOST=127.0.0.1 sudo -u admin /opt/node/bin/node server/index.js &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/    # 期望 200
node -e 'const d=require("/tmp/rt/data/db.json");console.log(d.activities.length,d.records.length)'
```

**真正恢复**：停服务 → 用备份里的 `db.json` 覆盖 `data/db.json`（必要时连 `uploads/` 一起还原）→ 启动。

## 7. 上线当天流程

1. 建活动 → 配奖项（名额=海报上的数量）→ 上传样品图 → 填价值
2. 生成抽奖码（前缀按校区/批次，如 `ZX`、`HD01`）
3. 配置校区预设，决定哪些字段必填
4. 拿手机扫一次二维码，走完整流程：发码 → 学员扫码开奖 → 保存领奖图
5. 舞台点「开始抽奖」→「停止」试一次，确认音效、动画、记录正常
6. 试完把测试记录和测试码撤销/重置，正式开抽

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 二维码扫不开 | 对外地址是 127.0.0.1 | 第 2 条填域名 |
| 微信点保存没反应 | http 环境 | 上 HTTPS；系统已内置「长按保存」兜底 |
| 学员页打不开 | 防火墙/端口没放行 | 第 4 条 |
| 别人发的码我这边数字没变 | 抽屉 6 秒自动刷新，或手动刷新 | 等 6 秒 |
| 剩余名额突然变满 | 有人点了重置或旧版本的保存 bug | 已修；看卡片「重置于」时间 |
| 服务崩了 | 进程退出 | 用 .bat 或任务计划程序自动拉起 |
| 数据文件损坏 | 断电等 | 启动时会自动把坏文件另存，并从 backups 恢复最近的 |

## 9. 安全边界

- 所有权限校验在服务端；前端只负责隐藏入口
- 会话：HttpOnly + SameSite=Lax 的随机 token，12 小时过期
- 密码：scrypt 加盐哈希
- 公开接口（学员自助）限流：开奖 300 次/10 分钟/IP，摘要 6000 次/10 分钟/IP
- 上传图片只接受 JPG/PNG/WebP，≤3MB，落盘为随机文件名
