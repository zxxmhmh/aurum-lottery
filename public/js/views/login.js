import { api } from '../api.js';
import { html, raw, icon, esc } from '../ui.js';
import { bindThemeButtons } from '../theme.js';



export function renderLogin(host, { onSuccess, message = '' } = {}) {
  host.innerHTML = html`
    <div class="auth">
      <button class="theme-toggle theme-toggle--float" data-theme-btn type="button"></button>
      <section class="auth-left">
        <div class="auth-brand">
          <span class="brand-mark">智</span>
          <div>
            <span class="brand-en">ZHIXUE</span>
            <span class="brand-cn">内部抽奖系统</span>
          </div>
        </div>

        <div class="auth-headline">
          <div class="eyebrow">Lottery control room</div>
          <h1>让每一次揭晓，<em>都值得屏息。</em></h1>
          <p>
            为年会、发布会与会员日准备的抽奖控制台。账号分权到人，名额实时递减，
            每一次开奖都有据可查——舞台灯光之外，秩序仍然清晰。
          </p>
        </div>

        <div class="auth-features">
          <div class="auth-feature">
            <b>Quota</b>
            <span>名单抽奖：每抽一次扣减一个名额，抽完即止。</span>
          </div>
          <div class="auth-feature">
            <b>Weighted</b>
            <span>概率抽奖与抽奖码：按权重开奖，一码一次。</span>
          </div>
          <div class="auth-feature">
            <b>Access</b>
            <span>九项权限、五种角色，逐人配置。</span>
          </div>
        </div>

        <div class="auth-left-foot">Est. 2026 · Designed for live moments</div>
      </section>

      <section class="auth-right">
        <div class="auth-card">
          <div class="eyebrow">Sign in</div>
          <h2>进入控制台</h2>
          <p class="auth-sub">使用管理员分配的账号登录，你的权限决定可见范围。</p>

          <form class="auth-form" id="login-form" novalidate>
            <div class="field">
              <label for="account">账号 / Account</label>
              <input class="input" id="account" name="account" autocomplete="username" placeholder="admin" spellcheck="false" required />
            </div>
            <div class="field">
              <label for="password">密码 / Password</label>
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
            </div>
            <div class="auth-error${message ? ' is-shown' : ''}" id="auth-error">${message}</div>
            <button class="btn btn--gold btn--block" type="submit" id="login-submit">进入控制台</button>
          </form>

          <div class="auth-foot">
            <span>智学 · 内部抽奖 v2.0</span>
            <span>Local instance</span>
          </div>
        </div>
      </section>
    </div>
  `;

  const form = host.querySelector('#login-form');
  const errorEl = host.querySelector('#auth-error');
  const accountInput = host.querySelector('#account');
  const passwordInput = host.querySelector('#password');
  const submit = host.querySelector('#login-submit');

  bindThemeButtons(host);

  host.querySelectorAll('[data-account]').forEach((chip) => {
    chip.addEventListener('click', () => {
      accountInput.value = chip.dataset.account;
      passwordInput.value = chip.dataset.password;
      errorEl.classList.remove('is-shown');
      submit.focus();
    });
  });

  accountInput.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const account = accountInput.value.trim();
    const password = passwordInput.value;
    if (!account || !password) {
      errorEl.textContent = '请输入账号与密码';
      errorEl.classList.add('is-shown');
      return;
    }
    submit.disabled = true;
    submit.textContent = '验证中…';
    errorEl.classList.remove('is-shown');
    try {
      const { user } = await api.post('/auth/login', { account, password });
      onSuccess(user);
    } catch (err) {
      errorEl.textContent = err.message || '登录失败，请重试';
      errorEl.classList.add('is-shown');
      passwordInput.select();
      host.querySelector('.auth-card').animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-7px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 280, easing: 'ease-in-out' },
      );
    } finally {
      submit.disabled = false;
      submit.textContent = '进入控制台';
    }
  });
}
