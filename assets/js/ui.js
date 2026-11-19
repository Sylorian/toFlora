/* ==========================================================================
   ui.js —— 开场小窗、抽流星按钮、键盘、点空白处收起

   全部内容在构建时就烘进页面了，这里不发任何请求。
   ========================================================================== */
(function (window, document) {
  'use strict';

  var NS = (window.FLORA = window.FLORA || {});

  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches ? el.matches(sel) : el.msMatchesSelector(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* localStorage 只是「记住这个浏览器抽过什么」，读不到就当作没有，
     任何情况下都不报错、不影响页面。 */
  function load(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, val) {
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* 无痕模式 / 存储满：忽略 */
    }
  }

  /* 风铃：不用音频文件，用几个正弦波现场合成。
     音高从一个五声音阶里随机取，所以每次都不一样、但永远不会难听。 */
  var BELL = [392.0, 440.0, 493.9, 587.3, 659.3, 784.0];
  var audio = null;
  var soundOn = true;

  function bell() {
    if (!soundOn) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();

      var now = audio.currentTime;
      /* 取 2–3 个音，间隔很短，像风铃被碰到 */
      var n = 2 + Math.floor(Math.random() * 2);
      for (var i = 0; i < n; i++) {
        var f = BELL[Math.floor(Math.random() * BELL.length)];
        var t0 = now + i * (0.06 + Math.random() * 0.09);
        var g = audio.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7 + i * 0.3);
        g.connect(audio.destination);

        var o1 = audio.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = f;
        o1.connect(g);

        /* 一个高八度、极轻的泛音：金属感的那一层 */
        var g2 = audio.createGain();
        g2.gain.value = 0.16;
        g2.connect(g);
        var o2 = audio.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2.01;
        o2.connect(g2);

        o1.start(t0); o2.start(t0);
        o1.stop(t0 + 2.6); o2.stop(t0 + 2.6);
      }
    } catch (e) {
      /* 浏览器不给声就算了 */
    }
  }

  function boot() {
    var night = document.querySelector('[data-night]');
    if (!night) return;

    var sky = NS.createSky({
      night: night,
      name: document.querySelector('[data-name]'),
      tick: document.querySelector('[data-tick]'),
      orb: document.querySelector('[data-orb]'),
      shade: document.querySelector('[data-shade]'),
      dust: document.querySelector('[data-dust]'),
      galaxy: document.querySelector('[data-galaxy]'),
      fieldFar: document.querySelector('[data-field="far"]'),
      fieldNear: document.querySelector('[data-field="near"]'),
      onDraw: function () { bell(); },
      stars: document.querySelector('[data-stars]'),
      meteors: document.querySelector('[data-meteors]'),
      card: document.querySelector('[data-card]'),
      link: document.querySelector('[data-link]')
    });
    NS.sky = sky;

    /* --------------------------------------------------------- 星星 --- */

    var presets = (window.__FLORA_PRESETS__ || []).slice();
    var featured = (window.__FLORA_FEATURED__ || []).slice();

    /* 生日星：只有 hugo.yaml 里的日期就是今天，才把这句话交给 sky。
       日期按访客本地时间算，不联网、不上报。 */
    function birthdayWord(cfg) {
      if (!cfg || !cfg.date || !cfg.text) return '';
      var m = /^(\d{1,2})-(\d{1,2})$/.exec(String(cfg.date).trim());
      if (!m) return '';
      var now = new Date();
      var hit = now.getMonth() + 1 === parseInt(m[1], 10) &&
                now.getDate() === parseInt(m[2], 10);
      return hit ? cfg.text : '';
    }

    sky.setStars(presets, featured, birthdayWord(window.__FLORA_BIRTHDAY__));

    /* ----------------------------------------------------- 抽一颗流星 --- */

    /* -------------------------------------------------------- 存书签 --- */
    var saveBtn = document.querySelector('[data-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!sky.isHero()) return;
        var t = document.querySelector('[data-card-text]');
        if (!t || !t.textContent) return;
        saveBookmark(t.textContent).catch(function (e) {
          console.error('bookmark failed', e);
        });
      });
    }

    /* ------------------------------------------------ 背景音：钢琴 ---
       不用音频文件：一段原创的 8 小节，三个正弦泛音的单键音色，
       按谱面时间逐个排；循环无缝。 */

    var MUSIC = {
      ctx: null,
      master: null,
      on: true,
      timer: 0,
      step: 0,
      idx: 0,
      t0: 0,
      started: false
    };

    /* 最基础的钢琴单键：三个正弦泛音 + 6ms 起音 + 指数衰减。 */
    /* 原创的一小段：F 大调，70 BPM，8 小节（27.4 秒循环）。
       右手是一条能哼的旋律 —— 从三音 A4 起，走到 Dm 上落下来，
       第 5 小节推到 A5 是全曲最高点，第 8 小节收回 C5，正好接回开头。
       左手是根 · 五 · 八 · 五的四分音，只在下面托着。 */
    var LOOP = 27.429;
    var SCORE = [
      [0.0,87.31,0.3,0.81],[0.0,440.0,0.5,1.29],[0.857,130.81,0.3,0.81],[1.286,523.25,0.5,0.43],[1.714,174.61,0.3,0.81],
      [1.714,698.46,0.5,1.71],[2.571,130.81,0.3,0.81],[3.429,146.83,0.3,0.81],[3.429,659.26,0.5,1.29],[4.286,220.0,0.3,0.81],
      [4.714,587.33,0.5,0.43],[5.143,146.83,0.3,0.81],[5.143,523.25,0.5,1.71],[6.0,110.0,0.3,0.81],[6.857,116.54,0.3,0.81],
      [6.857,587.33,0.5,0.86],[7.714,174.61,0.3,0.81],[7.714,698.46,0.5,0.86],[8.571,233.08,0.3,0.81],[8.571,587.33,0.5,0.86],
      [9.429,174.61,0.3,0.81],[9.429,466.16,0.5,0.86],[10.286,130.81,0.3,0.81],[10.286,523.25,0.5,1.71],[11.143,196.0,0.3,0.81],
      [12.0,130.81,0.3,0.81],[12.0,392.0,0.5,1.71],[12.857,98.0,0.3,0.81],[13.714,110.0,0.3,0.81],[13.714,440.0,0.5,0.86],
      [14.571,164.81,0.3,0.81],[14.571,523.25,0.5,0.86],[15.429,220.0,0.3,0.81],[15.429,698.46,0.5,1.29],[16.286,164.81,0.3,0.81],
      [16.714,880.0,0.5,0.43],[17.143,146.83,0.3,0.81],[17.143,783.99,0.5,1.71],[18.0,220.0,0.3,0.81],[18.857,146.83,0.3,0.81],
      [18.857,698.46,0.5,1.71],[19.714,110.0,0.3,0.81],[20.571,116.54,0.3,0.81],[20.571,587.33,0.5,0.86],[21.429,174.61,0.3,0.81],
      [21.429,698.46,0.5,0.86],[22.286,233.08,0.3,0.81],[22.286,659.26,0.5,1.71],[23.143,174.61,0.3,0.81],[24.0,130.81,0.3,0.81],
      [24.0,587.33,0.5,0.86],[24.857,196.0,0.3,0.81],[24.857,523.25,0.5,2.57],[25.714,130.81,0.3,0.81],[26.571,98.0,0.3,0.81],
    ];

    function pianoNote(freq, when, gain, dur) {
      var ctx = MUSIC.ctx;
      if (!ctx) return;
      var g0 = typeof gain === 'number' ? gain : 0.4;
      var len = typeof dur === 'number' ? dur : 0.9;

      var out = ctx.createGain();
      out.gain.value = 1;
      out.connect(MUSIC.master);

      var partials = [[1, 1.0], [2, 0.3], [3, 0.1]];
      for (var i = 0; i < partials.length; i++) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq * partials[i][0];
        var g = ctx.createGain();
        var peak = 0.0001 + partials[i][1] * g0 * 0.34;
        var decay = len + 0.55;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(peak, when + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        o.connect(g);
        g.connect(out);
        o.start(when);
        o.stop(when + decay + 0.05);
      }
    }

    function musicTick() {
      if (!MUSIC.ctx || !MUSIC.on) return;
      var now = MUSIC.ctx.currentTime;
      if (!MUSIC.t0) MUSIC.t0 = now + 0.08;
      /* 标签页挂起过就别追了，直接从这一秒重新开始 */
      if (now - MUSIC.t0 > LOOP + 2) {
        MUSIC.t0 = now + 0.05;
        MUSIC.idx = 0;
      }
      var elapsed = now - MUSIC.t0;

      while (MUSIC.idx < SCORE.length) {
        var note = SCORE[MUSIC.idx];
        if (note[0] - elapsed > 0.45) break;
        var when = MUSIC.t0 + note[0];
        if (when > now) {
          pianoNote(note[1], when, note[2], note[3]);
        }
        MUSIC.idx++;
      }

      if (MUSIC.idx >= SCORE.length) {
        MUSIC.idx = 0;
        MUSIC.t0 += LOOP;
      }
    }

    function musicStart() {
      if (MUSIC.started || !MUSIC.on) return;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!MUSIC.ctx) MUSIC.ctx = new Ctx();
        if (MUSIC.ctx.state === 'suspended') MUSIC.ctx.resume();
        if (!MUSIC.master) {
          var ctx = MUSIC.ctx;
          MUSIC.master = ctx.createGain();
          MUSIC.master.gain.value = 0.16;
          MUSIC.master.connect(ctx.destination);
        }
        MUSIC.started = true;
        MUSIC.idx = 0;
        MUSIC.t0 = 0;
        musicTick();
        MUSIC.timer = window.setInterval(musicTick, 200);
      } catch (e) {
        /* 没有声音也不影响别的 */
      }
    }

    function musicStop() {
      MUSIC.started = false;
      window.clearInterval(MUSIC.timer);
      MUSIC.timer = 0;
    }

    /* 背景音开关：默认开，记住选择；第一次点屏幕/甩球时才真正开始 */
    MUSIC.on = load('flora.music.v1', true) !== false;
    var musicBtn = document.querySelector('[data-music]');
    function paintMusic() {
      if (!musicBtn) return;
      musicBtn.setAttribute('aria-pressed', MUSIC.on ? 'true' : 'false');
      musicBtn.setAttribute('aria-label', MUSIC.on ? '关闭背景音' : '打开背景音');
    }
    paintMusic();
    if (musicBtn) {
      musicBtn.addEventListener('click', function () {
        MUSIC.on = !MUSIC.on;
        save('flora.music.v1', MUSIC.on);
        paintMusic();
        if (MUSIC.on) musicStart();
        else musicStop();
      });
    }
    /* 浏览器不许自动播放：等第一个手势 */
    function armMusic() {
      window.removeEventListener('pointerdown', armMusic, true);
      window.removeEventListener('keydown', armMusic, true);
      if (MUSIC.on) musicStart();
    }
    window.addEventListener('pointerdown', armMusic, true);
    window.addEventListener('keydown', armMusic, true);

    /* 风铃开关 */
    var soundBtn = document.querySelector('[data-sound]');
    soundOn = load('flora.sound.v1', true) !== false;
    function paintSound() {
      if (!soundBtn) return;
      soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      soundBtn.setAttribute('aria-label', soundOn ? '关闭风铃' : '打开风铃');
    }
    paintSound();
    if (soundBtn) {
      soundBtn.addEventListener('click', function () {
        soundOn = !soundOn;
        save('flora.sound.v1', soundOn);
        paintSound();
        if (soundOn) bell();
      });
    }

    /* ------------------------------------------------- 存成一张书签 ---
       抽中之后可以存成一张竖版书签 PNG：柔化的星空底 + 手写体正文 +
       Sylorian + 日期，底部剪一个 V 形缺口。全部在本地算，不上传。 */

    async function saveBookmark(verse) {
      var W = 640;
      var H = 1600;
      try {
        await document.fonts.ready;
      } catch (e) {
        /* 字体没等到就用回退字体 */
      }

      var c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      var g = c.getContext('2d');
      if (!g) return;

      /* 1) 离屏画星空，再用 blur 贴回来 —— 就是「柔化的星空」 */
      var s = document.createElement('canvas');
      s.width = W;
      s.height = H;
      var sg = s.getContext('2d');

      var bg = sg.createLinearGradient(0, 0, W * 0.5, H);
      bg.addColorStop(0, '#0a0e20');
      bg.addColorStop(0.45, '#151b38');
      bg.addColorStop(1, '#070a15');
      sg.fillStyle = bg;
      sg.fillRect(0, 0, W, H);

      var blobs = [
        ['rgba(96,58,178,0.5)', W * 0.22, H * 0.2, W * 0.95],
        ['rgba(46,96,190,0.42)', W * 0.78, H * 0.66, W * 1.05]
      ];
      for (var b = 0; b < blobs.length; b++) {
        var rg = sg.createRadialGradient(
          blobs[b][1], blobs[b][2], 0, blobs[b][1], blobs[b][2], blobs[b][3]
        );
        rg.addColorStop(0, blobs[b][0]);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        sg.fillStyle = rg;
        sg.fillRect(0, 0, W, H);
      }

      for (var i = 0; i < 1200; i++) {
        var x = Math.random() * W;
        var y = Math.random() * H;
        var r = Math.random() * 1.3 + 0.3;
        var a = Math.random() * 0.55 + 0.12;
        sg.fillStyle = 'rgba(238,244,255,' + a.toFixed(3) + ')';
        sg.fillRect(x, y, r, r);
      }

      g.save();
      try {
        g.filter = 'blur(2.4px)';
      } catch (e) {
        /* 老浏览器就不柔了 */
      }
      g.drawImage(s, 0, 0);
      g.restore();

      /* 2) 中间提亮一点 */
      var vig = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.62);
      vig.addColorStop(0, 'rgba(255,246,230,0.05)');
      vig.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);

      /* 3) 正文：手写体，逐字换行 + 中文禁则 */
      g.font = '46px Xiaodou, "Kaiti SC", KaiTi, serif';
      g.fillStyle = '#fdf8ef';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      try {
        g.letterSpacing = '1px';
      } catch (e) {
        /* 忽略 */
      }

      var maxW = W * 0.78;
      var lines = [];
      var line = '';
      for (var k = 0; k < verse.length; k++) {
        var ch = verse[k];
        if (g.measureText(line + ch).width > maxW && line) {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      if (line) lines.push(line);

      var NO_END = '（「『《“【〈(‘';
      var NO_START = '，。、；：？！）」』》”】〉,.;:?!)';
      for (var w = 0; w < lines.length - 1; w++) {
        while (lines[w].length > 1 && NO_END.indexOf(lines[w].slice(-1)) >= 0) {
          lines[w + 1] = lines[w].slice(-1) + lines[w + 1];
          lines[w] = lines[w].slice(0, -1);
        }
        while (lines[w + 1].length > 1 && NO_START.indexOf(lines[w + 1].charAt(0)) >= 0) {
          lines[w] += lines[w + 1].charAt(0);
          lines[w + 1] = lines[w + 1].slice(1);
        }
      }

      var lh = 46 * 1.95;
      var startY = H * 0.47 - ((lines.length - 1) * lh) / 2;
      for (var m = 0; m < lines.length; m++) {
        g.fillText(lines[m], W / 2, startY + m * lh);
      }

      /* 4) 细线 + Sylorian + 日期（年/月/日） */
      var d = new Date();
      var dateText =
        d.getFullYear() +
        ' / ' +
        ('0' + (d.getMonth() + 1)).slice(-2) +
        ' / ' +
        ('0' + d.getDate()).slice(-2);

      var baseY = H * 0.8;
      g.strokeStyle = 'rgba(255,215,161,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(W / 2 - 56, baseY - 62);
      g.lineTo(W / 2 + 56, baseY - 62);
      g.stroke();

      g.font = '100 40px Raleway, sans-serif';
      try {
        g.letterSpacing = '9px';
      } catch (e) {
        /* 忽略 */
      }
      g.fillStyle = 'rgba(253,249,241,0.92)';
      g.fillText('Sylorian', W / 2 + 4, baseY - 8);

      g.font = '20px KaiTi, "Kaiti SC", serif';
      try {
        g.letterSpacing = '4px';
      } catch (e) {
        /* 忽略 */
      }
      g.fillStyle = 'rgba(255,228,195,0.6)';
      g.fillText(dateText, W / 2 + 2, baseY + 40);

      /* 5) 底部 V 形缺口 */
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(W / 2 - 66, H);
      g.lineTo(W / 2, H - 86);
      g.lineTo(W / 2 + 66, H);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'source-over';

      /* 6) 下载 */
      var name =
        'to-flora-' +
        d.getFullYear() +
        '-' +
        ('0' + (d.getMonth() + 1)).slice(-2) +
        '-' +
        ('0' + d.getDate()).slice(-2) +
        '.png';

      if (!c.toBlob) return;
      c.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 4000);
      }, 'image/png');
    }

    /* ------------------------------------------- 开场：落款 ---
       只有「Sylorian ／ 献给 Flora」一行，没有别的说明。
       当天第一次看 2.8 秒，之后 1.2 秒；点任意处 / Esc 可以提前收。 */

    var intro = document.querySelector('[data-intro]');
    var nameEl = document.querySelector('[data-name]');
    var introDone = false;
    var introTimer = 0;

    function openIntro() {
      if (!intro || introDone) return;
      intro.classList.add('is-open');
      intro.setAttribute('aria-hidden', 'false');
      if (nameEl) nameEl.classList.add('is-away');
      var tickEl = document.querySelector('[data-tick]');
      if (tickEl) tickEl.classList.add('is-away');
      var today = new Date().toISOString().slice(0, 10);
      var first = load('flora.seen.v1', '') !== today;
      save('flora.seen.v1', today);
      introTimer = window.setTimeout(closeIntro, first ? 2800 : 1200);
    }

    function closeIntro() {
      if (!intro || introDone) return;
      introDone = true;
      window.clearTimeout(introTimer);
      intro.classList.remove('is-open');
      intro.setAttribute('aria-hidden', 'true');
      if (nameEl) nameEl.classList.remove('is-away');
      var tickEl2 = document.querySelector('[data-tick]');
      if (tickEl2) tickEl2.classList.remove('is-away');
    }

    if (intro) window.setTimeout(openIntro, 1700);

    /* ------------------------------------------------- 点空白处收起 --- */

    document.addEventListener('click', function (e) {
      if (closest(e.target, '[data-intro-close]')) return;
      if (sky.justDragged && sky.justDragged()) return;

      /* 抽签状态：点卡片以外的地方就继续。
         鼠标 = 收起（要看星空了）；手指 = 再抽一颗（手机上换一句是第一需求）。 */
      if (sky.isHero && sky.isHero()) {
        if (closest(e.target, '[data-card]')) return;
        else sky.closeHero();
        return;
      }
      /* 点星星自己会 pin，不在这里处理 */
      if (closest(e.target, '[data-star]')) return;
      sky.closeAll();
    }, false);

    /* ----------------------------------------------------------- Esc --- */

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      if (!introDone) { closeIntro(); return; }
      if (sky.isHero && sky.isHero()) { sky.closeHero(); return; }
      sky.closeAll();
    }, false);

    /* 注意：不要给按钮加 touchstart + preventDefault。
       那样会让浏览器不再派发 click，手机上按了没反应（桌面完全正常，很难发现）。 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})(window, document);
