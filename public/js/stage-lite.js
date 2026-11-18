
(function () {
  // 开奖结果停留时长：够学生上台合影，再自动回宣传页
  var RESULT_HOLD_MS = 120000;

  var state = { activity: null, activities: [], rolling: false, timer: null, prizes: [], lastCode: '', lookup: null, lookupFor: '', busy: false, tick: 0, idleTimer: null, introTimer: null };

  /* ---------------------------------------------------------------- 音效 */
  var sfx = (function () {
    var on = true;
    try { on = localStorage.getItem('aurum.sound') !== 'off'; } catch (e) { on = true; }
    var cache = {};
    var files = { tick: '/sounds/tick.wav', reveal: '/sounds/reveal.wav', miss: '/sounds/miss.wav' };
    var volumes = { tick: 0.6, reveal: 1.0, miss: 0.75 };
    function preload() {
      for (var key in files) {
        if (!files.hasOwnProperty(key)) continue;
        try {
          var audio = new Audio(files[key]);
          audio.preload = 'auto';
          audio.volume = volumes[key];
          cache[key] = audio;
        } catch (e) { /* 老机器不支持就静音 */ }
      }
    }
    function play(name) {
      if (!on) return;
      var audio = cache[name];
      if (!audio) return;
      try {
        audio.currentTime = 0;
        var p = audio.play();
        if (p && p['catch']) p['catch'](function () {});
      } catch (e) { /* 自动播放被拦就算了 */ }
    }
    return {
      isOn: function () { return on; },
      toggle: function () {
        on = !on;
        try { localStorage.setItem('aurum.sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
        if (on) play('tick');
        return on;
      },
      tick: function () { play('tick'); },
      reveal: function () { play('reveal'); },
      miss: function () { play('miss'); },
      preload: preload
    };
  })();
  sfx.preload();
  function paintSound() {
    var btn = $('sound-btn');
    if (!btn) return;
    btn.innerHTML = '音效' + (sfx.isOn() ? '开' : '关');
    btn.className = 'sound-btn' + (sfx.isOn() ? '' : ' off');
  }
  var soundBtn = $('sound-btn');
  if (soundBtn) {
    soundBtn.onclick = function () {
      sfx.toggle();
      paintSound();
    };
  }
  paintSound();

  function $(id) { return document.getElementById(id); }
  // 结果态：只留「下一位」按钮，抽奖控件收起
  function setResultMode(on) {
    var box = document.querySelector('.controls');
    if (box) box.className = on ? 'controls is-result' : 'controls';
    show('next-row', on);
  }

  function show(id, on) { var el = $(id); if (!el) return; if (on) el.className = el.className.replace(/\s*hidden/g, ''); else if (el.className.indexOf('hidden') < 0) el.className += ' hidden'; }
  function hint(text, isErr) { var el = $('hint'); el.innerHTML = text || ''; el.className = 'hint' + (isErr ? ' err' : ''); }
  function flashCode() {
    var el = $('code');
    if (!el) return;
    el.className = 'code err';
    setTimeout(function () { el.className = 'code'; }, 1200);
  }

  function api(method, path, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    function finish(status, data) {
      if (done) return;
      done = true;
      cb(status, data);
    }
    x.open(method, path, true);
    x.setRequestHeader('Content-Type', 'application/json');
    // 15 秒没响应就按失败处理，避免界面卡在“揭晓中”
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null;
      try { data = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) { data = null; }
      finish(x.status, data);
    };
    x.ontimeout = function () { finish(0, null); };
    x.onerror = function () { finish(0, null); };
    try { x.send(body ? JSON.stringify(body) : null); } catch (e) { finish(0, null); }
  }

  function setBtn(text, isStop, disabled) {
    var b = $('draw-btn');
    b.innerHTML = text;
    b.className = 'btn' + (isStop ? ' stop' : '');
    b.disabled = !!disabled;
  }

  // 剩余名额：抽奖码模式按“发码即占位”算（服务端 quotaView），其余按奖品名额
  function quotaNumbers(a) {
    var qv = a && a.quotaView;
    if (qv && typeof qv.total === 'number') {
      return { total: qv.total, left: Math.max(0, qv.remaining || 0) };
    }
    var total = 0;
    var left = 0;
    var list = (a && a.prizes) || [];
    for (var i = 0; i < list.length; i += 1) {
      total += list[i].quota || 0;
      left += list[i].remaining || 0;
    }
    return { total: total, left: left };
  }

  function paintPrizes() {
    var html = '';
    var list = state.prizes || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      html += '<div class="prize"><span class="r">' + (p.remaining || 0) + '/' + (p.quota || 0) + '</span>'
        + '<div class="n">' + esc(p.name) + '</div>'
        + '<div class="m">' + esc(p.level || '') + (p.value ? ' · ¥' + p.value : '') + '</div></div>';
    }
    $('prizes').innerHTML = html || '<div class="feed-item">还没有奖项</div>';
    var q = quotaNumbers(state.activity);
    $('quota').innerHTML = q.left + ' / ' + q.total;
  }

  /* ------------------------------------------------------------ 宣传页 */

  function renderIntro(a) {
    if (!a) return;
    var name = a.name || '';
    var titleEl = $('intro-title');
    titleEl.innerHTML = esc(name);
    // 名字太长就往小收，避免把下面的内容顶出屏幕
    titleEl.style.fontSize = name.length > 24 ? '68px' : name.length > 16 ? '84px' : '';
    $('intro-sub').innerHTML = esc(a.subtitle || '');
    $('intro-copy').innerHTML = esc(a.description || '');
    var list = a.prizes || [];
    var qn = quotaNumbers(a);
    var total = qn.total;
    var left = qn.left;
    // 抽奖码模式且名额已发完：大屏不显示 0/500，改成“已发完 + 待开奖人数”
    var soldOut = a.mode === 'code' && left <= 0 && total > 0;
    var lineEl = document.querySelector('.intro-quota-line');
    var barEl = $('intro-bar-fill');
    var tipEl = $('intro-quota-tip');
    if (soldOut) {
      var c = a.codes || {};
      var issued = c.issued || 0;
      var pending = Math.max(0, issued - (c.used || 0));
      if (lineEl) {
        lineEl.innerHTML = '<span>名额已发完</span><b>' + issued + '</b><span>人已领码</span>';
      }
      $('intro-quota').innerHTML = issued + ' / ' + total;
      if (barEl) {
        barEl.style.width = '100%';
        barEl.className = 'bar-high';
      }
      if (tipEl) {
        tipEl.innerHTML = pending > 0
          ? ('待开奖 ' + pending + ' 人 · 凭码现场开奖')
          : '全部已开奖 · 感谢参与';
      }
    } else {
      $('intro-quota').innerHTML = left + ' / ' + total;
      // 大号“剩余名额”：名额 total，剩 left
      var numEl = $('intro-quota-num');
      if (numEl) numEl.innerHTML = left;
      var totEl = $('intro-quota-total');
      if (totEl) totEl.innerHTML = '/ ' + total;
      if (barEl) {
        var pct = total > 0 ? Math.round((left / total) * 100) : 0;
        var ratio = total > 0 ? left / total : 0;
        barEl.style.width = pct + '%';
        // 剩余越少，进度条颜色越热：金 → 橙红 → 深红（深红还会呼吸闪）
        barEl.className = ratio <= 0.15 ? 'bar-low' : ratio <= 0.45 ? 'bar-mid' : 'bar-high';
      }
      if (tipEl) {
        var r2 = total > 0 ? left / total : 0;
        tipEl.innerHTML = r2 <= 0.15 ? '名额即将抽完，先到先得' : r2 <= 0.45 ? '名额已过半，抓紧时间' : '';
      }
    }
    var html = '';
    var maxCards = 8;
    // 奇数个奖项时，让第一个（最高等级）单独占一行，其余两两成行
    var featured = list.length % 2 === 1 && list.length > 1;
    for (var k = 0; k < list.length && k < maxCards; k += 1) {
      var p = list[k];
      var bg = p.image
        ? '<div class="pc-blur" style="background-image:url(' + esc(p.image) + ')"></div>'
          + '<div class="pc-bg" style="background-image:url(' + esc(p.image) + ')"></div>'
        : '<div class="pc-bg pc-bg--empty"></div>';
      html += '<div class="prize-card' + (featured && k === 0 ? ' featured' : '') + '">' + bg
        + '<div class="pc-body">'
        + '<div class="lv">' + esc(p.level || '奖项') + (p.value ? ' · ¥' + p.value : '') + '</div>'
        + '<div class="nm">' + esc(p.name || '') + '</div>'
        + '<div class="rm">剩余 <b>' + (p.remaining || 0) + '</b> / ' + (p.quota || 0) + '</div>'
        + '</div></div>';
    }
    if (list.length > maxCards) {
      html += '<div class="prize-more">另有 ' + (list.length - maxCards) + ' 个奖项现场揭晓</div>';
    }
    $('intro-prizes').innerHTML = html;
    var ctaEl = $('intro-cta');
    if (ctaEl) ctaEl.innerHTML = a.mode === 'quota' ? '点击屏幕 · 开始抽奖' : '点击屏幕 · 输入抽奖码开奖';
    // 内容比可用高度多时，整体等比缩小，保证一屏放得下（不裁切、不滚动）
    setTimeout(fitIntro, 30);
  }

  function fitIntro() {
    var wrap = $('intro-scale');
    var main = document.querySelector('.intro-main');
    if (!wrap || !main) return;
    wrap.style.transform = 'none';
    wrap.style.webkitTransform = 'none';
    var avail = main.clientHeight;
    var natural = wrap.offsetHeight;
    if (!natural || !avail || natural <= avail) return;
    var s = avail / natural;
    wrap.style.transform = 'scale(' + s + ')';
    wrap.style.webkitTransform = 'scale(' + s + ')';
  }

  // 中止正在进行的滚动（返回宣传页 / 退出登录 / 待机回首页时都要停掉，否则会一直在后台滚）

  // 滚动中隐藏退出/返回（只留音效）
  function setRolling(on) {
    var cls = ' ' + (document.body.className || '') + ' ';
    if (on) {
      if (cls.indexOf(' rolling ') < 0) document.body.className = (document.body.className || '') + ' rolling';
    } else {
      document.body.className = (document.body.className || '').replace(/\s*rolling\s*/g, ' ').replace(/^\s+|\s+$/g, '');
    }
    var code = $('code');
    var phone = $('phone');
    if (code) code.disabled = !!on;
    if (phone) phone.disabled = !!on;
  }
  function cancelRoll() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    state.rolling = false;
    state.tick = 0;
    setRolling(false);
    var circle = $('circle');
    if (circle) circle.className = 'circle';
    var wi = $('win-img');
    if (wi) wi.style.backgroundImage = '';
    setBtn('开始抽奖', false, false);
  }

  function showIntro() {
    cancelRoll();
    setResultMode(false);
    show('intro', true);
    show('stage', false);
    $('code').value = '';
    $('phone').value = '';
    show('phone-field', false);
    state.lookup = null;
    state.lookupFor = '';
    $('circle').className = 'circle';
    var wi2 = $('win-img');
    if (wi2) wi2.style.backgroundImage = '';
    $('eyebrow').innerHTML = 'READY TO DRAW';
    $('name').innerHTML = '等待开奖';
    $('meta').innerHTML = '按下「开始抽奖」';
    setBtn('开始抽奖', false, false);
    hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
    if (state.activity) loadActivity(function () {});
  }

  function enterStage() {
    if (!state.activity) return;
    if (state.introTimer) clearTimeout(state.introTimer);
    show('intro', false);
    show('stage', true);
    // 不自动聚焦输入框：广告机上自动聚焦会直接弹键盘，页面一进来就变了样
    setTyping(false);
    scheduleIdle();
  }

  function scheduleIdle() {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(function () {
      var el = $('stage');
      if (el && el.className.indexOf('hidden') < 0) showIntro();
    }, 90000);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function loadActivity(cb) {
    api('GET', '/api/activities', null, function (status, data) {
      if (status === 401) { showLogin(); return; }
      if (status === 403 && data && data.code === 'password_change_required') {
        $('login-tip').innerHTML = '这个账号还没改初始密码，请先在电脑上登录后台改掉，再回来登录。';
        $('login-tip').style.color = '#e07a5f';
        showLogin(); return;
      }
      if (status !== 200 || !data || !data.activities) { hint('读取活动失败，请稍后刷新', true); return; }
      var list = [];
      for (var i = 0; i < data.activities.length; i++) {
        // code = 抽奖码；quota = 名单抽奖（大屏从名单里抽人）
        if (data.activities[i].mode === 'code' || data.activities[i].mode === 'quota') list.push(data.activities[i]);
      }
      state.activities = list;
      if (!list.length) { hint('还没有可用的抽奖活动', true); return; }
      var pick = null;
      for (var k = 0; k < list.length; k++) { if (list[k].status === 'active') { pick = list[k]; break; } }
      pick = pick || list[0];
      selectActivity(pick.id, cb);
    });
  }

  function isRoster() {
    return Boolean(state.activity && state.activity.mode === 'quota');
  }

  function findPrize(id) {
    for (var i = 0; i < state.prizes.length; i += 1) {
      if (state.prizes[i].id === id) return state.prizes[i];
    }
    return null;
  }

  // 名单抽奖：奖项选择按钮
  function buildChips() {
    var box = $('prize-pick');
    if (!box) return;
    var firstReady = '';
    var out = '';
    for (var i = 0; i < state.prizes.length; i += 1) {
      var p = state.prizes[i];
      var left = p.remaining || 0;
      if (!firstReady && left > 0) firstReady = p.id;
      out += '<button type="button" class="chip' + (left <= 0 ? ' off' : '') + '" data-prize="' + p.id + '"'
        + (left <= 0 ? ' disabled' : '') + '><b>' + esc(p.name) + '</b><i>剩 ' + left + '</i></button>';
    }
    box.innerHTML = out;
    var cur = findPrize(state.prizeId);
    if (!cur || (cur.remaining || 0) <= 0) state.prizeId = firstReady;
    paintChips();
    var chips = box.querySelectorAll('.chip');
    for (var k = 0; k < chips.length; k += 1) {
      chips[k].onclick = function () {
        if (state.rolling || this.disabled) return;
        state.prizeId = this.getAttribute('data-prize');
        paintChips();
        var p = findPrize(state.prizeId);
        hint(p ? ('本次抽「' + p.name + '」· 剩 ' + (p.remaining || 0) + ' 名') : '请选择奖项', false);
      };
    }
  }

  function paintChips() {
    var chips = document.querySelectorAll('#prize-pick .chip');
    for (var i = 0; i < chips.length; i += 1) {
      var on = chips[i].getAttribute('data-prize') === state.prizeId;
      chips[i].className = 'chip' + (on ? ' on' : '') + (chips[i].disabled ? ' off' : '');
    }
  }

  function applyMode() {
    var roster = isRoster();
    var cls = ' ' + (document.body.className || '') + ' ';
    if (roster) {
      if (cls.indexOf(' roster ') < 0) document.body.className = (document.body.className || '') + ' roster';
      buildChips();
      var rosterInfo = state.activity.roster || { total: 0, left: 0 };
      hint('名单抽奖 · 名单 ' + rosterInfo.total + ' 人 · 还没抽 ' + rosterInfo.left + ' 人', false);
    } else {
      document.body.className = (document.body.className || '').replace(/\s*roster\s*/g, ' ').replace(/^\s+|\s+$/g, '');
      hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
    }
  }

  function selectActivity(id, cb) {
    api('GET', '/api/activities/' + id, null, function (status, data) {
      if (status !== 200 || !data || !data.activity) { hint('读取活动失败', true); return; }
      var a = data.activity;
      state.activity = a;
      state.prizes = a.prizes || [];
      $('act-name').innerHTML = esc(a.name);
      paintPrizes();
      renderIntro(a);
      applyMode();
      show('login', false);
      if (cb) cb();
      refreshFeed();
    });
  }

  function refreshFeed() {
    if (!state.activity) return;
    api('GET', '/api/records?activityId=' + state.activity.id + '&limit=6', null, function (status, data) {
      if (status !== 200 || !data || !data.records) return;
      var html = '';
      for (var i = 0; i < data.records.length; i++) {
        var r = data.records[i];
        var t = new Date(r.at);
        html += '<div class="feed-item">' + esc(r.prizeName || '') + ' · ' + esc(r.code || '') + ' · '
          + (t.getHours() < 10 ? '0' : '') + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes()
          + (r.participant ? ' · ' + esc(r.participant) : '') + '</div>';
      }
      $('feed').innerHTML = html || '<div class="feed-item">还没有开奖</div>';
    });
  }

  function showLogin() {
    cancelRoll();
    show('login', true);
    show('stage', false);
    show('intro', false);
    var btn = $('logout-btn');
    if (btn) {
      btn.className = 'logout-btn hidden';
      btn.innerHTML = '退出登录';
    }
  }

  function doLogout() {
    cancelRoll();
    api('POST', '/api/auth/logout', {}, function () {
      state.activity = null;
      state.activities = [];
      state.prizes = [];
      state.lookup = null;
      state.lookupFor = '';
      if (state.idleTimer) clearTimeout(state.idleTimer);
      if (state.introTimer) clearTimeout(state.introTimer);
      $('acc').value = '';
      $('pwd').value = '';
      showLogin();
      $('login-tip').innerHTML = '已退出登录。用老师账号重新登录即可继续。';
      $('login-tip').style.color = '#7d6f58';
    });
  }

  function afterLogin() {
    loadActivity(function () { showIntro(); });
    var btn = $('logout-btn');
    if (btn) {
      btn.className = 'logout-btn';
      btn.innerHTML = '退出登录';
    }
  }

  function doLogin() {
    var acc = $('acc').value.replace(/^\s+|\s+$/g, '');
    var pwd = $('pwd').value;
    if (!acc || !pwd) { $('login-tip').innerHTML = '请填写账号和密码'; return; }
    $('login-btn').disabled = true;
    var body = { account: acc, password: pwd };
    if ($('remember') && $('remember').checked) body.remember = true;
    api('POST', '/api/auth/login', body, function (status, data) {
      $('login-btn').disabled = false;
      if (status === 200 && data && data.user) {
        if (data.user.mustChangePassword) {
          $('login-tip').innerHTML = '这个账号还没改初始密码，请先在电脑上改掉再来。';
          $('login-tip').style.color = '#e07a5f';
          return;
        }
        afterLogin();
        return;
      }
      $('login-tip').innerHTML = (data && data.error) || '登录失败';
      $('login-tip').style.color = '#e07a5f';
    });
  }

  function lookup(code) {
    if (!state.activity || !code) return;
    var actId = state.activity.id;
    api('GET', '/api/activities/' + actId + '/codes/' + encodeURIComponent(code) + '/lookup', null, function (status, data) {
      if (status !== 200 || !data) { state.lookup = null; return; }
      state.lookup = data;
      state.lookupFor = code;
      if (data.needsPhone) {
        show('phone-field', true);
        hint('这枚码登记：' + esc(data.holder || '') + ' ' + esc(data.phoneMask || '') + ' · 请核对手机号', false);
      } else {
        show('phone-field', false);
        $('phone').value = '';
        hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
      }
    });
  }

  function startRolling() {
    if (isRoster()) {
      var p = findPrize(state.prizeId);
      if (!p) { hint('请先选择要抽的奖项', true); return; }
      if ((p.remaining || 0) <= 0) { hint('「' + p.name + '」名额已抽完，换个奖项', true); return; }
      var info = state.activity.roster || { total: 0, left: 0 };
      if (!info.total) { hint('名单还是空的，请先在后台导入参与名单', true); return; }
      if (!info.left) { hint('名单里的人都已经中过奖了', true); return; }
      beginRoll();
      return;
    }
    var code = $('code').value.replace(/\s+/g, '').toUpperCase();
    if (!code) { flashCode(); hint('请先输入 6 位抽奖码，再点开始抽奖', true); $('code').focus(); return; }
    if (!state.lookup || state.lookupFor !== code) {
      // 先查一次，查完再决定要不要手机号
      api('GET', '/api/activities/' + state.activity.id + '/codes/' + encodeURIComponent(code) + '/lookup', null, function (status, data) {
        if (status !== 200 || !data) { flashCode(); hint('没有找到这枚抽奖码，请核对', true); return; }
        state.lookup = data;
        state.lookupFor = code;
        if (data.used) { flashCode(); hint('这枚码已经抽过了', true); return; }
        if (data.needsPhone) {
          show('phone-field', true);
          hint('这枚码登记：' + esc(data.holder || '') + ' ' + esc(data.phoneMask || '') + ' · 请填手机号再开奖', false);
          $('phone').focus();
          return;
        }
        beginRoll();
      });
      return;
    }
    if (state.lookup.used) { hint('这枚码已经抽过了', true); return; }
    if (state.lookup.needsPhone) {
      var phone = $('phone').value.replace(/\D/g, '');
      if (!phone) { hint('这枚码登记了手机号，请先填写', true); $('phone').focus(); return; }
      if (!/^1[3-9]\d{9}$/.test(phone)) { hint('手机号要 11 位', true); $('phone').focus(); return; }
    }
    beginRoll();
  }

  function beginRoll() {
    setTyping(false);
    setResultMode(false);
    if (state.introTimer) { clearTimeout(state.introTimer); state.introTimer = null; }
    state.rolling = true;
    setRolling(true);
    state.lastCode = isRoster() ? '' : $('code').value.replace(/\s+/g, '').toUpperCase();
    var circle = $('circle');
    circle.className = 'circle rolling';
    var wi = $('win-img');
    if (wi) wi.style.backgroundImage = '';
    $('eyebrow').innerHTML = 'DRAWING';
    $('meta').innerHTML = '再按一次停止揭晓';
    setBtn('停 止', true, false);
    var names = [];
    for (var i = 0; i < state.prizes.length; i++) { if ((state.prizes[i].remaining || 0) > 0) names.push(state.prizes[i].name); }
    if (!names.length) names = ['谢谢参与'];
    var idx = 0;
    state.tick = 0;
    state.timer = setInterval(function () {
      idx = (idx + 1) % names.length;
      $('name').innerHTML = esc(names[idx]);
      state.tick += 1;
      if (state.tick % 2 === 0) sfx.tick();
    }, 90);
  }

  function stopRolling() {
    if (!state.rolling) return;
    state.rolling = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    setBtn('揭晓中…', true, true);
    var body = isRoster() ? { prizeId: state.prizeId } : { code: state.lastCode };
    if (!isRoster() && state.lookup && state.lookup.needsPhone) body.phone = $('phone').value.replace(/\D/g, '');
    if (state.busy) return;
    state.busy = true;
    api('POST', '/api/activities/' + state.activity.id + '/draw', body, function (status, data) {
      state.busy = false;
      setRolling(false);
      var winImg = $('win-img');
      setBtn('开始抽奖', false, false);
      if (status === 200 && data) {
        var hit = data.hit && data.prize;
        if (hit) sfx.reveal(); else sfx.miss();
        $('circle').className = 'circle';
        if (winImg) winImg.style.backgroundImage = '';
        if (hit && data.prize.image) {
          if (winImg) winImg.style.backgroundImage = 'url(' + data.prize.image + ')';
          $('circle').className = 'circle win';
        }
        $('eyebrow').innerHTML = hit ? 'WINNER' : 'NOT THIS TIME';
        if (isRoster()) {
          // 名单抽奖：大字显示中奖姓名
          var win = data.winner || {};
          $('name').innerHTML = hit ? esc(win.name || (data.record && data.record.participant) || '') : '未抽中';
          $('meta').innerHTML = hit
            ? (data.record && data.record.level ? esc(data.record.level) + ' · ' : '') + esc(data.prize.name)
            : '本次没有抽出奖项';
        } else {
          $('name').innerHTML = hit ? esc(data.prize.name) : '谢谢参与';
          $('meta').innerHTML = (data.record && data.record.level ? esc(data.record.level) + ' · ' : '') + esc(state.lastCode) + (data.holder ? ' · ' + esc(data.holder) : '');
        }
        $('code').value = '';
        $('phone').value = '';
        show('phone-field', false);
        state.lookup = null;
        if (isRoster()) {
          var info = data.roster || (data.activity && data.activity.roster) || { total: 0, left: 0 };
          hint('名单 ' + info.total + ' 人 · 还没抽 ' + info.left + ' 人', false);
        } else {
          hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
        }
        loadActivity(function () {});
        refreshFeed();
        // 开奖后留足时间拍照合影，再自动回宣传页；也提供「下一位」按钮立即继续
        setResultMode(true);
        if (state.introTimer) clearTimeout(state.introTimer);
        state.introTimer = setTimeout(showIntro, RESULT_HOLD_MS);
        return;
      }
      var msg = (data && data.error) || '开奖失败';
      hint(msg, true);
      if (data && (data.code === 'phone_required' || data.code === 'phone_mismatch')) {
        show('phone-field', true);
        $('phone').focus();
        $('phone').select && $('phone').select();
      } else {
        $('code').focus();
      }
    });
  }

  function toggleDraw() { if (state.rolling) { stopRolling(); } else { startRolling(); } }


  // 改了码就重新查，避免拿着上一次的结果继续走
  $('code').oninput = function () {
    var v = $('code').value.replace(/\s+/g, '').toUpperCase();
    if (state.lookupFor && v !== state.lookupFor) {
      state.lookup = null;
      state.lookupFor = '';
      show('phone-field', false);
      $('phone').value = '';
      hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
    }
  };
  $('draw-btn').onclick = toggleDraw;

  // 开奖后点「下一位」：留在抽奖页，清掉结果准备下一位
  function resetStage() {
    if (state.introTimer) { clearTimeout(state.introTimer); state.introTimer = null; }
    cancelRoll();
    setResultMode(false);
    $('circle').className = 'circle';
    var wi = $('win-img');
    if (wi) wi.style.backgroundImage = '';
    $('eyebrow').innerHTML = 'READY TO DRAW';
    $('name').innerHTML = '等待开奖';
    $('meta').innerHTML = '按下「开始抽奖」';
    $('code').value = '';
    $('phone').value = '';
    show('phone-field', false);
    state.lookup = null;
    state.lookupFor = '';
    setBtn('开始抽奖', false, false);
    if (isRoster()) {
      var info = (state.activity && state.activity.roster) || { total: 0, left: 0 };
      hint('名单抽奖 · 名单 ' + info.total + ' 人 · 还没抽 ' + info.left + ' 人', false);
    } else {
      hint('直接输 6 位码 · 登记过手机号的需核对手机号', false);
    }
    scheduleIdle();
  }
  var nextBtn = $('next-btn');
  if (nextBtn) nextBtn.onclick = resetStage;
  $('login-btn').onclick = doLogin;

  // 广告机的输入法会盖住底部：聚焦输入框时把输入区顶到屏幕上方
  function setTyping(on) {
    var cls = ' ' + (document.body.className || '') + ' ';
    if (on) {
      if (cls.indexOf(' typing ') < 0) document.body.className = (document.body.className || '') + ' typing';
    } else {
      document.body.className = (document.body.className || '').replace(/\s*typing\s*/g, ' ').replace(/^\s+|\s+$/g, '');
    }
  }
  function onInputFocus() { setTyping(true); }
  function onInputBlur() {
    setTimeout(function () {
      var a = document.activeElement;
      if (a && (a.id === 'code' || a.id === 'phone' || a.id === 'acc' || a.id === 'pwd')) return;
      setTyping(false);
    }, 150);
  }
  ['code', 'phone', 'acc', 'pwd'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.onfocus = onInputFocus;
    el.onblur = onInputBlur;
  });

  // 退出登录：第一次点变成确认态，3 秒内再点一次才真的退出，防误触
  var logoutBtn = $('logout-btn');
  var logoutTimer = null;
  if (logoutBtn) {
    logoutBtn.onclick = function () {
      if (logoutTimer) {
        clearTimeout(logoutTimer);
        logoutTimer = null;
        doLogout();
        return;
      }
      logoutBtn.innerHTML = '再点一次退出';
      logoutBtn.className = 'logout-btn confirm';
      logoutTimer = setTimeout(function () {
        logoutTimer = null;
        logoutBtn.innerHTML = '退出登录';
        logoutBtn.className = 'logout-btn';
      }, 3000);
    };
  }
  var introEl = $('intro');
  if (introEl) introEl.onclick = enterStage;
  var backEl = $('back-to-intro');
  if (backEl) backEl.onclick = function () { showIntro(); };
  // 舞台上任何操作都重置待机计时
  var stageEl = $('stage');
  if (stageEl) stageEl.onclick = function () {
    if (state.introTimer) { clearTimeout(state.introTimer); state.introTimer = null; }
    scheduleIdle();
  };
  $('code').onblur = function () { var v = $('code').value.replace(/\s+/g, '').toUpperCase(); if (v.length >= 4) lookup(v); };
  $('code').onkeydown = function (e) { var k = e.keyCode || e.which; if (k === 13) { e.preventDefault && e.preventDefault(); toggleDraw(); } };
  $('phone').onkeydown = function (e) { var k = e.keyCode || e.which; if (k === 13) { e.preventDefault && e.preventDefault(); toggleDraw(); } };

  // 竖屏（9:16 广告机）自动切布局：收侧栏、放大圆盘
  function applyLayout() {
    var portrait = window.innerWidth < window.innerHeight;
    var cls = ' ' + (document.body.className || '') + ' ';
    if (portrait) {
      if (cls.indexOf(' portrait ') < 0) document.body.className = (document.body.className || '') + ' portrait';
    } else {
      document.body.className = (document.body.className || '').replace(/\s*portrait\s*/g, ' ').replace(/^\s+|\s+$/g, '');
    }
    // 固定设计稿宽度（竖屏 1080，横屏 1920），按宽度整体缩放，高度铺满屏幕
    var rigW = portrait ? 1080 : 1920;
    var app = document.getElementById('app');
    if (!app) return;
    var scale = window.innerWidth / rigW;
    if (scale <= 0) return;
    var designH = Math.round(window.innerHeight / scale);
    app.style.width = rigW + 'px';
    app.style.height = designH + 'px';
    app.style.transform = 'scale(' + scale + ')';
    app.style.webkitTransform = 'scale(' + scale + ')';
  }
  applyLayout();
  window.onresize = applyLayout;

  // 每 20 秒刷新一次名额（不开奖时）
  setInterval(function () {
    if (!state.activity || state.rolling) return;
    api('GET', '/api/activities/' + state.activity.id, null, function (status, data) {
      if (status === 200 && data && data.activity) {
        state.activity = data.activity;
        state.prizes = data.activity.prizes || [];
        paintPrizes();
        if (isRoster()) buildChips();
      }
    });
  }, 20000);

  // 前台开关：广告机被关闭时，整块换成“已关闭”
  function showClosedScreen(fe) {
    var app = $('app');
    if (app) app.className = 'hidden';
    var old = document.getElementById('closed-screen');
    if (old) return;
    var box = document.createElement('div');
    box.id = 'closed-screen';
    box.className = 'closed-screen';
    var title = document.createElement('div');
    title.className = 'closed-title';
    title.textContent = (fe && fe.title) || '本场抽奖已关闭';
    var note = document.createElement('div');
    note.className = 'closed-note';
    note.textContent = (fe && fe.note) || '管理员已关闭，请联系现场工作人员。';
    box.appendChild(title);
    box.appendChild(note);
    document.body.appendChild(box);
  }

  // 启动：先看前台开关，再判断登录
  api('GET', '/api/public/frontends', null, function (feStatus, feData) {
    if (feStatus === 200 && feData && feData.stageLite && feData.stageLite.enabled === false) {
      showClosedScreen(feData.stageLite);
      return;
    }
    startApp();
  });

  function startApp() {
  api('GET', '/api/auth/me', null, function (status, data) {
    if (status === 200 && data && data.user) {
      if (data.user.mustChangePassword) {
        $('login-tip').innerHTML = '这个账号还没改初始密码，请先在电脑上改掉再来。';
        $('login-tip').style.color = '#e07a5f';
        showLogin();
        return;
      }
      afterLogin();
    } else {
      showLogin();
    }
  });
  }
})();
