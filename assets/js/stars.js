/* ==========================================================================
   stars.js —— 那颗会转的球

   球面坐标 → 透视投影 → 每帧写 transform。星星分两种：

     preset   多、暗、偏冷白（data/presets.txt）
     featured 少、亮、偏暖金、星芒常亮（data/featured.txt）

   「抽一颗流星」= 下一场流星雨 + 从 featured 里随机挑一颗，让它飞到画面正中。

   对外只暴露 window.FLORA.createSky(dom)。
   ========================================================================== */
(function (window, document) {
  'use strict';

  var NS = (window.FLORA = window.FLORA || {});

  var BASE_SPIN = 0.034;   /* rad/s：不拖、也不看某颗星时的自转速度（一圈约 3 分钟） */
  var FOCAL = 8;           /* 透视焦距，单位是半径：8 表示很温和的透视 */
  var MIN_FRONT = 0.1;     /* 星转到背面到这个程度就把卡片收掉 */

  /* 手机：窄屏、或只有触摸的粗指针设备。开启后会关掉一批
   「桌面看不出差别、但在手机上很贵」的东西。 */
var IS_MOBILE =
  window.matchMedia('(max-width: 820px)').matches ||
  window.matchMedia('(pointer: coarse)').matches;

var seq = 0;             /* 句子没有 id，自己发一个 */

  function rand(a, b) { return a + (b - a) * Math.random(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function px(n) { return (Math.round(n * 10) / 10) + 'px'; }

  function reduced() {
    return !!(
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function span(cls) {
    var el = document.createElement('span');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* ========================================================================== */

  function createSky(dom) {
    var orb = dom.orb;
    var starsLayer = dom.stars;
    var dustLayer = dom.dust;
    var meteorsLayer = dom.meteors;
    var card = dom.card;
    var link = dom.link;
    var nightEl = dom.night;
    var textEl = card.querySelector('[data-card-text]');

    var state = {
      items: [],
      featured: [],
      frame: { w: 0, h: 0 },
      cx: 0,
      cy: 0,
      radius: 300,

      /* 旋转：yaw 是「实际转到哪儿」，target 是「手/自转想让它在哪儿」，
         两者之间做一点平滑，拖起来有重量感、不会一顿一顿 */
      yaw: 0,
      yawTarget: 0,
      pitch: -0.14,
      pitchTarget: -0.14,
      drift: 0,             /* 很慢的俯仰漂移，让球不像转盘 */
      spin: BASE_SPIN,
      vel: 0,               /* 最近几次拖动的平均速度，甩出去时用它，比只看最后一帧稳 */
      clock: 0,
      showerAng: 24,
      drag: null,
      dragGuard: 0,

      active: null,
      pinned: false,
      reduced: reduced(),

      hero: null,           /* 抽中的那颗星 */
      drawing: false,

      pointerX: -9999,
      pointerY: -9999,
      parallax: { x: 0, y: 0, wx: -9, wy: -9 },
      lights: [],
      rimX: -9999,
      rimY: -9999,
      cardLx: -9999,
      cardLy: -9999,
      lightPx: -9999,
      lightPy: -9999,
      tiltX: 0,
      tiltY: 0,
      tiltXt: -9,
      tiltYt: -9,
      gyroX: 0,
      gyroY: 0,
      gyroSeen: false,
      stirred: false,
      birthday: false,
      birthdayText: '',
      breath: 0,

      card: { x: 0, y: 0, snap: true },
      last: 0,
      raf: 0,
      closeTimer: 0,
      hoverTimer: 0,
      lastMove: -1e9
    };

    /* ------------------------------------------------------------ 量尺寸 --- */

    function measure() {
      var w = window.innerWidth;
      var h = window.innerHeight;
      var narrow = w < 700;
      state.frame = { w: w, h: h };
      state.cx = w / 2;
      state.cy = h * (narrow ? 0.42 : 0.44);
      /* 半径尽量大，但要给下面两个控件（抽流星 / 重排）留净空：
         否则球底那几颗星会躲在按钮后面，点不到。 */
      state.radius = Math.max(
        110,
        Math.min(state.cx - 16, state.cy - 12, h - state.cy - 108)
      );
      if (dom.name) {
        dom.name.style.left = state.cx + 'px';
        dom.name.style.top = state.cy + 'px';
      }
      /* 球体的「体积」：一层很淡的球面明暗，让星星不是一个平面上的圈 */
      if (dom.shade) {
        var d = state.radius * 2;
        dom.shade.style.width = d + 'px';
        dom.shade.style.height = d + 'px';
        dom.shade.style.left = state.cx - state.radius + 'px';
        dom.shade.style.top = state.cy - state.radius + 'px';
      }
      state.avoid = [];
      [dom.draw].forEach(function (el) {
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width && r.height) state.avoid.push(r);
      });
    }

    /* -------------------------------------------------- 星野贴图（一次生成） ---
       把近千颗极暗的小星画进一张 canvas，之后当背景图用：
       每帧零成本，密度却能是 DOM 版本的五六倍。只在尺寸变化时重画。
    ------------------------------------------------------------------- */

    /* 星野：先在离屏画一场星空，留着当贴图。
       之前为了省事用 fillRect 画硬像素点，看着糙（用户反馈「不如之前好看」）；
       现在改成「软边发光精灵 + lighter 叠加」—— 一颗星是一个径向渐变的小光斑，
       亮的那些再贴一个十字星芒精灵。全部只在尺寸变化时画一次。 */

    var SPRITES = null;

    function makeSprite(rgb, spark) {
      var S = 64;
      var c = document.createElement('canvas');
      c.width = c.height = S;
      var g = c.getContext('2d');
      var r = S / 2;

      var rg = g.createRadialGradient(r, r, 0, r, r, r);
      rg.addColorStop(0, 'rgba(' + rgb + ',1)');
      rg.addColorStop(0.14, 'rgba(' + rgb + ',0.72)');
      rg.addColorStop(0.34, 'rgba(' + rgb + ',0.24)');
      rg.addColorStop(0.7, 'rgba(' + rgb + ',0.04)');
      rg.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, S, S);

      if (spark) {
        g.globalCompositeOperation = 'lighter';
        var gr = g.createLinearGradient(0, r, S, r);
        gr.addColorStop(0, 'rgba(' + rgb + ',0)');
        gr.addColorStop(0.5, 'rgba(' + rgb + ',0.55)');
        gr.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = gr;
        g.fillRect(0, r - 0.6, S, 1.2);

        var gv = g.createLinearGradient(r, 0, r, S);
        gv.addColorStop(0, 'rgba(' + rgb + ',0)');
        gv.addColorStop(0.5, 'rgba(' + rgb + ',0.55)');
        gv.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = gv;
        g.fillRect(r - 0.6, 0, 1.2, S);
      }
      return c;
    }

    function sprites() {
      if (SPRITES) return SPRITES;
      SPRITES = {
        dots: [
          makeSprite('238,244,255', false),
          makeSprite('206,224,255', false),
          makeSprite('255,236,206', false)
        ],
        sparks: [
          makeSprite('245,249,255', true),
          makeSprite('255,232,198', true)
        ]
      };
      return SPRITES;
    }

    function paintField(canvas, count, size, alpha, cross, dim) {
      if (!canvas) return;
      var sp = sprites();
      var dpr = Math.min(IS_MOBILE ? 1.25 : 2, window.devicePixelRatio || 1);
      var w = canvas.clientWidth || state.frame.w + 52;
      var h = canvas.clientHeight || state.frame.h + 52;
      if (canvas.width !== Math.round(w * dpr) ||
          canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      var g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';

      for (var i = 0; i < count; i++) {
        var x = Math.random() * w;
        var y = Math.random() * h;
        var t = Math.random();
        var sp1 = t > 0.94 ? sp.dots[2] : t > 0.72 ? sp.dots[1] : sp.dots[0];

        var base = rand(size[0], size[1]);
        var d = base * 5.5;                       /* 光斑直径 = 点径的 7 倍 */
        var al = rand(alpha[0], alpha[1]) * (dim || 1);
        g.globalAlpha = al > 1 ? 1 : al;
        g.drawImage(sp1, x - d / 2, y - d / 2, d, d);

        /* 少数亮的：再叠一颗带十字星芒的 */
        if (cross && Math.random() < 0.18) {
          var sd = base * rand(22, 34);
          g.globalAlpha = Math.min(1, al * 0.9);
          g.drawImage(sp.sparks[Math.random() < 0.3 ? 1 : 0], x - sd / 2, y - sd / 2, sd, sd);
        }
      }

      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    function buildFields() {
      paintField(dom.fieldFar, 1250, [0.34, 0.95], [0.18, 0.52], false, 1);
      paintField(dom.fieldNear, 300, [0.7, 1.5], [0.42, 0.98], true, 0.68);
    }

    function isBirthday(cfg) {
      if (!cfg || !cfg.date || !cfg.text) return false;
      var m = /^(\d{1,2})-(\d{1,2})$/.exec(String(cfg.date).trim());
      if (!m) return false;
      var now = new Date();
      return now.getMonth() + 1 === parseInt(m[1], 10) &&
             now.getDate() === parseInt(m[2], 10);
    }

    /* ------------------------------------------------------------ 背景星尘 --- */

    function buildDust() {
      dustLayer.textContent = '';
      var w = state.frame.w;
      var h = state.frame.h;
      var far = Math.sqrt(
        Math.pow(Math.max(state.cx, w - state.cx), 2) +
          Math.pow(Math.max(state.cy, h - state.cy), 2)
      );
      /* 星尘从 170 降到 96：密度现在交给星野贴图（近千颗、零帧成本），
         这一层只负责「会闪的那几颗」。实测每减 70 个元素约 +6fps。 */
      var count = IS_MOBILE ? 18 : w < 700 ? 48 : 96;
      var frag = document.createDocumentFragment();

      for (var i = 0; i < count; i++) {
        var r = Math.sqrt(Math.random()) * (far + 30);
        var a = rand(0, Math.PI * 2);
        var el = document.createElement('span');
        var bright = Math.random() < 0.16;
        /* 只有一小部分星尘会闪：几百个元素各自跑动画太贵，
           而且满天同时闪反而不像真的星空 */
        var live = Math.random() < (bright ? 0.32 : 0.12);
        el.className =
          'dust' + (bright ? ' dust--bright' : '') + (live ? ' dust--live' : '');
        el.style.setProperty('--x', px(state.cx + Math.cos(a) * r));
        el.style.setProperty('--y', px(state.cy + Math.sin(a) * r));
        el.style.setProperty('--s', rand(0.7, 2.3).toFixed(2) + 'px');
        el.style.setProperty('--o', rand(0.3, 0.92).toFixed(2));
        el.style.setProperty('--d', rand(3.5, 9).toFixed(2) + 's');
        el.style.setProperty('--dl', (-rand(0, 9)).toFixed(2) + 's');
        frag.appendChild(el);
      }
      dustLayer.appendChild(frag);
    }

    /* --------------------------------------------------------- 球面坐标 --- */

    /* 斐波那契球面：n 个点在球面上等面积分布 */
    function spherePoint(i, n) {
      var y = 1 - (2 * (i + 0.5)) / Math.max(1, n);
      var theta = i * Math.PI * (3 - Math.sqrt(5));
      return { y: y, theta: theta };
    }

    function phiOf(y) { return Math.asin(clamp(y, -1, 1)); }

    /* ------------------------------------------------------------ 投影 --- */

    var COS = { y: 1, p: 1 };
    var SIN = { y: 0, p: 0 };

    function project(it) {
      var cp = Math.cos(it.phi);
      var x0 = cp * Math.cos(it.theta);
      var y0 = Math.sin(it.phi);
      var z0 = cp * Math.sin(it.theta);

      /* 绕 Y 轴转（yaw） */
      var x1 = x0 * COS.y + z0 * SIN.y;
      var z1 = -x0 * SIN.y + z0 * COS.y;
      /* 绕 X 轴转（pitch） */
      var y2 = y0 * COS.p - z1 * SIN.p;
      var z2 = y0 * SIN.p + z1 * COS.p;

      var k = FOCAL / (FOCAL - z2);
      it.sx = state.cx + x1 * state.radius * k;
      it.sy = state.cy + y2 * state.radius * k;
      it.k = k;
      it.front = (z2 + 1) * 0.5;          /* 0 = 最远 1 = 最近 */
    }

    function render() {
      /* 先把这一帧的光源算出来：球面受光方向 + 每条流星此刻的头部 */
      var nowMs = performance.now();
      /* 球体的光跟着鼠标（手机是陀螺仪倾角）走：
         受光点、边缘光、方向光都吃这一个方向。 */
      var lamX = state.parallax.x;
      var lamY = state.parallax.y;
      /* 受光点：光方向投在球面上的那个位置，那里的星最亮 */
      var litX = state.cx + lamX * state.radius * 0.62;
      var litY = state.cy + lamY * state.radius * 0.62;
      var litR2 = Math.pow(state.radius * 0.62, 2);
      var lightList = [];
      for (var lk = 0; lk < state.lights.length; lk++) {
        var LL = state.lights[lk];
        var pr = (nowMs - LL.t0) / LL.dur;
        if (pr < 0 || pr > 1) continue;
        lightList.push({
          x: LL.x + LL.ax * LL.len * pr,
          y: LL.y + LL.ay * LL.len * pr,
          r2: 230 * 230
        });
      }

      var pitch = clamp(state.pitch + state.drift, -1.05, 1.05);
      COS.y = Math.cos(state.yaw);
      SIN.y = Math.sin(state.yaw);
      COS.p = Math.cos(pitch);
      SIN.p = Math.sin(pitch);

      for (var i = 0; i < state.items.length; i++) {
        var it = state.items[i];
        project(it);
        if (it.flying) continue;            /* 飞出去那颗由它自己管 */

        var f = it.front;
        var scale = (0.55 + 0.92 * f) * it.k;
        var op = 0.16 + 0.84 * f;

        /* 有卡片钉住时，其余的星退后半步（不 blur，只压暗 + 微缩） */
        if (state.dimOthers && it !== state.active) {
          scale *= 0.985;
          op *= 0.76;
        }

        /* 球面受光：星在球面上朝光源那一侧就亮，背面就暗。
           用屏幕坐标相对球心的方向当法线，足够像「有个灯在照」。 */
        var boost = 0;
        var nx2 = (it.sx - state.cx) / (state.radius || 1);
        var ny2 = (it.sy - state.cy) / (state.radius || 1);
        var lam = nx2 * lamX + ny2 * lamY;

        /* ① 方向光：受光面整体提亮，背面压暗 */
        if (lam > 0) boost += 0.85 * lam * (0.35 + 0.65 * f);
        else op *= 1 + lam * 0.34;

        /* ② 轮廓光：靠边（front 小）且朝光源的那些星被"点亮边缘" */
        if (lam > 0 && f < 0.55) {
          var rimT = (1 - f / 0.55) * (1 - f / 0.55);
          boost += 1.15 * rimT * lam;
        }

        /* ③ 受光点高光：光源正对的那一小片星额外亮起来 */
        var dxl = it.sx - litX;
        var dyl = it.sy - litY;
        var dl = dxl * dxl + dyl * dyl;
        if (dl < litR2) {
          var t = 1 - dl / litR2;
          boost += 0.95 * t * t * (0.45 + 0.55 * f);
        }
        for (var li2 = 0; li2 < lightList.length; li2++) {
          var L = lightList[li2];
          var dly = it.sy - L.y;
          var dlx = it.sx - L.x;
          var dl2 = dlx * dlx + dly * dly;
          if (dl2 < L.r2) {
            boost += 0.55 * (1 - dl2 / L.r2);
          }
        }
        if (boost > 0) {
          /* 提亮 + 微放大：正面的星本来就到顶了，只提亮看不出变化 */
          var lit = op * (1 + boost);
          op = lit > 1 ? 1 : lit;
          scale *= 1 + boost * 0.55;
        }

        /* 球转得很慢（0.034 rad/s）：单帧位移常常不到半个像素，
           这时候重写 transform 是纯浪费 —— 109 颗星每帧 109 次样式写入，
           正是低端机上卡的主要原因。位移 < 0.5px 且缩放没变就跳过。 */
        var moved =
          it._x === undefined ||
          Math.abs(it.sx - it._x) > 0.5 ||
          Math.abs(it.sy - it._y) > 0.5 ||
          Math.abs(scale - (it._s || 0)) > 0.008;
        if (moved) {
          it._x = it.sx;
          it._y = it.sy;
          it._s = scale;
          it.el.style.transform =
            'translate3d(' + px(it.sx) + ',' + px(it.sy) + ',0) scale(' +
            (Math.round(scale * 1000) / 1000) + ')';
        }

        /* 闪烁：直接乘在这一帧本来就要写的 opacity 上，
           不再让每颗星都跑一个 CSS 动画（那是手机上最大的开销）。 */
        if (it.live) {
          op *= 0.68 + 0.32 * Math.sin(state.clock * it.twSpeed + it.twPhase);
        }

        /* 量化到 0.04 一档：肉眼看不出，但写入次数少一半 */
        var o = Math.round(op * 25) / 25;
        if (it._o !== o) { it.el.style.opacity = o; it._o = o; }

        var z = Math.round(f * 200);
        if (it._z === undefined || Math.abs(z - it._z) >= 2) {
          it.el.style.zIndex = z;
          it._z = z;
        }
      }

      if (state.active && state.active !== state.hero) {
        if (state.active.front < MIN_FRONT) hide();
        else followCard();
      }

    }

    /* ------------------------------------------------------------ 帧循环 --- */

    var skipFrame = false;

    function frame(now) {
      state.raf = window.requestAnimationFrame(frame);

      /* 手机上隔帧渲染（30fps）：球转得很慢，肉眼几乎看不出；
         低端机省下来的一半 CPU 就是「不卡」和「卡」的差别。
         dt 用的是真实时间差，所以运动速度不变。 */
      if (IS_MOBILE && !state.reduced) {
        skipFrame = !skipFrame;
        if (skipFrame) return;
      }

      if (!state.last) state.last = now;
      var dt = Math.min(64, now - state.last) / 1000;
      state.last = now;
      state.clock += dt;

      /* 俯仰上一点极慢的漂移（±0.1 rad，约 100 秒一个来回）：
         纯绕竖轴转会像唱片机，加这一点就不像了 */
      if (!state.reduced) {
        state.drift = 0.1 * Math.sin(state.clock * 0.062) +
                      0.035 * Math.sin(state.clock * 0.017 + 1.7);
      }

      if (!state.drag) {
        /* 自转速度也在缓慢呼吸（0.72–1.22 倍），不是死板匀速 */
        var breathe = state.reduced
          ? 0
          : 1 + 0.25 * Math.sin(state.clock * 0.055 + 0.6);
        var cruise = state.reduced || state.hero ? 0 : BASE_SPIN * breathe;

        /* 惯性衰减：先快后慢，尾巴长一点，停得不生硬 */
        state.spin += (cruise - state.spin) * Math.min(1, dt * 1.6);
        if (Math.abs(state.spin) < 0.002 && Math.abs(cruise) < 0.002) state.spin = 0;
        state.yawTarget += state.spin * dt;
      }

      /* 实际角度追目标角度：22/s 的收敛速度 ≈ 45ms 的跟随，
         拖起来有重量感，又不会觉得延迟 */
      var follow = 1 - Math.exp(-dt * 22);
      state.yaw += (state.yawTarget - state.yaw) * follow;
      state.pitch += (state.pitchTarget - state.pitch) * follow;

      /* 甩球搅动天空：转得越快，流星越多、银河越亮 */
      var sp = Math.abs(state.spin || 0);
      if (!state.reduced && !state.hero && sp > 1.5) {
        var chance = Math.min(0.5, dt * (sp - 1.2) * 0.9);
        if (Math.random() < chance) spawnMeteor(0);
      }
      if (dom.galaxy) {
        var stirred = sp > 1.6;
        if (stirred !== state.stirred) {
          state.stirred = stirred;
          dom.galaxy.classList.toggle('is-stirred', stirred);
        }
      }

      /* 位置过渡（重排） */
      for (var i = 0; i < state.items.length; i++) {
        var it = state.items[i];
        if (!it.t1) continue;
        var p = (now - it.t0) / (it.t1 - it.t0);
        if (p >= 1) {
          it.theta = it.toTheta;
          it.phi = it.toPhi;
          it.t1 = 0;
        } else {
          var e = easeOut(p);
          it.theta = it.fromTheta + (it.toTheta - it.fromTheta) * e;
          it.phi = it.fromPhi + (it.toPhi - it.fromPhi) * e;
        }
      }

      /* 视差只给「to Flora」：鼠标位置（或陀螺仪倾角）→ -1..1，
         平滑后写到 CSS 变量上。陀螺仪存在时以它为主。 */
      var pvx = 0;
      var pvy = 0;
      if (state.gyroSeen) {
        pvx = state.gyroY / 14;
        pvy = state.gyroX / 14;
      } else if (state.pointerX > -999) {
        pvx = (state.pointerX / state.frame.w - 0.5) * 2;
        pvy = (state.pointerY / state.frame.h - 0.5) * 2;
      }
      pvx = pvx < -1 ? -1 : pvx > 1 ? 1 : pvx;
      pvy = pvy < -1 ? -1 : pvy > 1 ? 1 : pvy;
      var pk = 1 - Math.exp(-dt * 3.4);
      state.parallax.x += (pvx - state.parallax.x) * pk;
      state.parallax.y += (pvy - state.parallax.y) * pk;
      /* 变化小于 0.004 就不写：静止时省掉 7 个字的样式重算 */
      if (dom.name &&
          (Math.abs(state.parallax.x - state.parallax.wx) > 0.004 ||
           Math.abs(state.parallax.y - state.parallax.wy) > 0.004)) {
        state.parallax.wx = state.parallax.x;
        state.parallax.wy = state.parallax.y;
        dom.name.style.setProperty('--u', state.parallax.x.toFixed(3));
        dom.name.style.setProperty('--v', state.parallax.y.toFixed(3));
        if (dom.flow) {
          dom.flow.style.setProperty('--px', state.parallax.x.toFixed(3));
          dom.flow.style.setProperty('--py', state.parallax.y.toFixed(3));
        }
        /* 光源方向：鼠标（手机上是陀螺仪倾角）。它不再画一层光，
           而是当成一盏灯去照球体 —— 受光面亮、背面暗。 */
      }

      /* 卡片内部受光：只有抽签那张卡片有 —— 跟着鼠标（手机上是陀螺仪）走，
         普通卡片就是一块安静的玻璃。 */
      if (state.active && state.active === state.hero && !state.reduced) {
        var cxp = Math.round((50 + state.parallax.x * 38) * 10) / 10;
        var cyp = Math.round((50 + state.parallax.y * 34) * 10) / 10;
        if (Math.abs(cxp - state.cardLx) > 0.8 || Math.abs(cyp - state.cardLy) > 0.8) {
          state.cardLx = cxp;
          state.cardLy = cyp;
          card.style.setProperty('--clx', cxp + '%');
          card.style.setProperty('--cly', cyp + '%');
          card.style.setProperty('--cdx', (100 - cxp) + '%');
          card.style.setProperty('--cdy', (100 - cyp) + '%');
        }
      }

      /* 卡片倾斜：有陀螺仪就跟手机姿态走（安卓），没有就跟着鼠标 */
      if (state.active && !state.reduced) {
        var tRx = 0;
        var tRy = 0;
        if (state.gyroSeen) {
          tRx = state.gyroX;
          tRy = state.gyroY;
        } else {
          var cb = card.getBoundingClientRect();
          if (cb.width) {
            var nx = clamp((state.pointerX - (cb.left + cb.width / 2)) / (cb.width * 0.9), -1, 1);
            var ny = clamp((state.pointerY - (cb.top + cb.height / 2)) / (cb.height * 1.6), -1, 1);
            tRx = ny * -6;
            tRy = nx * 7;
          }
        }
        var kk = 1 - Math.exp(-dt * 9);
        state.tiltX += (tRx - state.tiltX) * kk;
        state.tiltY += (tRy - state.tiltY) * kk;
        /* 同理：倾斜变化小于 0.03° 就不碰 DOM */
        if (Math.abs(state.tiltX - state.tiltXt) > 0.03 ||
            Math.abs(state.tiltY - state.tiltYt) > 0.03) {
          state.tiltXt = state.tiltX;
          state.tiltYt = state.tiltY;
          card.style.setProperty('--rx', state.tiltX.toFixed(2) + 'deg');
          card.style.setProperty('--ry', state.tiltY.toFixed(2) + 'deg');
        }
      }
      render();
    }

    function tweenTo(it, theta, phi, dur) {
      it.fromTheta = it.theta;
      it.fromPhi = it.phi;
      /* 角度走近路，别绕一圈 */
      while (theta - it.theta > Math.PI) theta -= Math.PI * 2;
      while (theta - it.theta < -Math.PI) theta += Math.PI * 2;
      it.toTheta = theta;
      it.toPhi = phi;
      it.t0 = performance.now();
      it.t1 = it.t0 + (dur || 760);
    }

    /* ------------------------------------------------------------ 星元件 --- */

    function createStar(it) {
      var b = document.createElement('button');
      b.type = 'button';
      /* 只有一部分星挂「呼吸」动画：一百多颗星全都各自跑 CSS 动画，
         软件渲染下帧率会掉一半；而且真的星空也不是每颗都在闪。
         亮星一律会闪，它们是主角。 */
      /* 闪烁：每颗星有自己的周期和相位，永远不同步。
         手机上只给一小部分挂动画（上百个 CSS 动画会拖垮低端机）。 */
      it.live =
        it.birthday || it.kind === 'featured' ||
        Math.random() < (IS_MOBILE ? 0.04 : 0.62);
      b.className =
        'star star--' + it.tint +
        (it.kind === 'featured' ? ' star--featured' : '') +
        (it.birthday ? ' star--birthday' : '') +
        (it.live ? ' star--live' : '');
      b.setAttribute('data-star', it.id);
      b.setAttribute('aria-label', String(it.text).slice(0, 40));

      /* 闪烁参数：周期与相位随机，所以永远不同步 */
      it.twSpeed = rand(0.7, 1.6);
      it.twPhase = rand(0, Math.PI * 2);
      b.style.setProperty('--halo', it.halo.toFixed(2));
      b.style.setProperty('--tw-dur', rand(3.4, 7.6).toFixed(2) + 's');
      b.style.setProperty('--tw-delay', (-rand(0, 7)).toFixed(2) + 's');
      b.style.setProperty('--s', px(it.size));

      var body = span('star__body');
      /* 手机上只给「会闪的」和亮星建光晕、只给亮星建星芒：
         元素数从 327 降到 150 左右，暗星本来也就一两个像素。 */
      if (!IS_MOBILE || it.live) body.appendChild(span('star__halo'));
      body.appendChild(span('star__core'));
      if (!IS_MOBILE || it.kind === 'featured' || it.birthday) {
        body.appendChild(span('star__spark'));
      }
      b.appendChild(body);

      b.addEventListener('click', function () {
        if (justDragged()) return;
        if (state.hero) { closeHero(); return; }
        pin(it.id);
      });
      /* 悬停预览：等 110ms 再打开 —— 球自己转的时候星会从指针下滑过，
         一进一出就闪一张卡会很吵；真的停上去才展开。 */
      b.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch' || state.hero || state.pinned || state.drag) return;
        /* 指针没在动就不要弹卡：球一直在转，星会自己滑到指针底下 */
        if (performance.now() - state.lastMove > 400) return;
        cancelHover();
        state.hoverTimer = window.setTimeout(function () {
          state.hoverTimer = 0;
          if (state.drag || state.pinned || state.hero) return;
          show(it, false);
        }, 110);
      });
      b.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'touch' || state.pinned || state.hero) return;
        cancelHover();
        scheduleClose();
      });

      return b;
    }

    /* ------------------------------------------------------------ 卡片 --- */

    function cardWidth() {
      var w = state.frame.w;
      if (w < 700) return Math.max(212, Math.min(w - 34, 300));
      return Math.min(340, Math.max(250, w * 0.23));
    }

    function cardHeight() {
      card.style.setProperty('--w', px(cardWidth()));
      return card.offsetHeight || 140;
    }

    function targetPos(it, ch) {
      var cw = cardWidth();
      var gap = 22 + it.size * it.k * 0.5;
      var x = it.cardSide === 'right' ? it.sx + gap : it.sx - gap - cw;
      var y = it.cardVert === 'down' ? it.sy + gap : it.sy - gap - ch;
      var pad = 14;
      x = clamp(x, pad, Math.max(pad, state.frame.w - cw - pad));
      y = clamp(y, pad, Math.max(pad, state.frame.h - ch - pad));

      /* 碰到下面两个按钮就让开，往上抬 */
      var avoid = state.avoid || [];
      for (var i = 0; i < avoid.length; i++) {
        var a = avoid[i];
        if (x < a.right + 10 && x + cw > a.left - 10 && y + ch > a.top - 10) {
          y = Math.max(pad, a.top - 12 - ch);
        }
      }
      return { x: x, y: y, w: cw, h: ch };
    }

    /* 抽签模式：星在正中，卡片在它下面居中 */
    function heroPos(ch) {
      var w = state.frame.w;
      var h = state.frame.h;
      var cw = Math.min(w - 44, 400);
      var starY = h < 640 ? h * 0.24 : h * 0.28;
      return {
        x: Math.round((w - cw) / 2),
        y: Math.round(starY + 62),
        w: cw,
        h: ch,
        starX: w / 2,
        starY: starY
      };
    }

    function followCard() {
      var it = state.active;
      if (!it) return;
      var box = targetPos(it, it.cardH || cardHeight());

      if (state.card.snap) {
        state.card.x = box.x;
        state.card.y = box.y;
        state.card.snap = false;
      } else {
        /* 跟随时带一点滞后：切换星、拖动球的时候卡片是「飘过去」的 */
        state.card.x += (box.x - state.card.x) * 0.3;
        state.card.y += (box.y - state.card.y) * 0.3;
      }

      card.style.left = px(state.card.x);
      card.style.top = px(state.card.y);
      updateLink(it, { x: state.card.x, y: state.card.y, w: box.w, h: box.h });
    }

    function updateLink(it, box) {
      if (!link) return;
      var ccx = box.x + box.w / 2;
      var ccy = box.y + box.h / 2;
      var dx = ccx - it.sx;
      var dy = ccy - it.sy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len;
      var uy = dy / len;

      var sx = it.sx + ux * (it.size * it.k * 0.6 + 6);
      var sy = it.sy + uy * (it.size * it.k * 0.6 + 6);

      /* 射线进入矩形的那个交点：往右走就是左边界，往左走是右边界 */
      var tx = ux !== 0 ? ((ux > 0 ? box.x : box.x + box.w) - it.sx) / ux : Infinity;
      var ty = uy !== 0 ? ((uy > 0 ? box.y : box.y + box.h) - it.sy) / uy : Infinity;
      var t = Math.min(tx, ty);
      if (!isFinite(t) || t <= 0) {
        link.classList.remove('is-on');
        return;
      }
      var ex = it.sx + ux * t;
      var ey = it.sy + uy * t;
      var lw = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy));
      if (lw < 8) {
        link.classList.remove('is-on');
        return;
      }

      link.style.setProperty('--lx', px(sx));
      link.style.setProperty('--ly', px(sy));
      link.style.setProperty(
        '--la',
        ((Math.atan2(ey - sy, ex - sx) * 180) / Math.PI).toFixed(2) + 'deg'
      );
      link.style.setProperty('--lw', px(lw));
      link.classList.add('is-on');
    }

    /* ---------------------------------------------------------- 展开逻辑 --- */

    function show(it, pin) {
      cancelClose();
      state.dimOthers = false;
      if (state.active === it) {
        if (pin) state.pinned = true;
        return;
      }
      state.active = it;
      if (pin) state.pinned = true;

      textEl.textContent = it.text;
      it.cardSide = it.sx >= state.cx ? 'right' : 'left';
      it.cardVert = it.sy >= state.cy ? 'down' : 'up';
      it.cardH = cardHeight();

      state.card.snap = true;
      state.dimOthers = !!pin;          /* 只有点了才让其余星退后，悬停不折腾 */
      /* 倾斜归零：不然卡片会带着上一次的角度出现 */
      state.tiltX = 0;
      state.tiltY = 0;
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');

      /* 普通卡片不受光：把抽签留下的光斑清掉 */
      card.style.setProperty('--ctint', '0,0,0');
      card.classList.add('is-open');
      sync();
      followCard();
      return it;
    }

    function hide() {
      cancelClose();
      state.dimOthers = false;
      state.active = null;
      state.pinned = false;
      state.card.snap = true;
      card.classList.remove('is-open');
      link.classList.remove('is-on');
      sync();
    }

    function sync() {
      for (var i = 0; i < state.items.length; i++) {
        state.items[i].el.classList.toggle(
          'is-active', state.items[i] === state.active
        );
      }
    }

    function cancelHover() {
      if (state.hoverTimer) {
        window.clearTimeout(state.hoverTimer);
        state.hoverTimer = 0;
      }
    }

    function cancelClose() {
      if (state.closeTimer) {
        window.clearTimeout(state.closeTimer);
        state.closeTimer = 0;
      }
    }

    function scheduleClose() {
      cancelClose();
      state.closeTimer = window.setTimeout(function () {
        state.closeTimer = 0;
        if (state.pinned) return;
        hide();
      }, 140);
    }

    function pin(id) {
      var it = null;
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].id === id) { it = state.items[i]; break; }
      }
      if (!it) return;
      if (state.pinned && state.active === it) { hide(); return; }
      show(it, true);
    }

    /* 名字和它下面那条线是两个元素，状态要一起切 */
    function setNameClass(cls, on) {
      if (dom.name) dom.name.classList.toggle(cls, on);
      if (dom.tick) dom.tick.classList.toggle(cls, on);
    }

    /* ---------------------------------------------------------- 拖动 --- */

    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      state.vel = 0;
      state.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: 0,
        captured: false,
        t: performance.now()
      };
      orb.classList.add('is-dragging');
    }

    function onMove(e) {
      var d = state.drag;
      if (!d || e.pointerId !== d.id) return;
      var dx = e.clientX - d.x;
      var dy = e.clientY - d.y;
      if (!dx && !dy) return;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);

      /* 真的开始拖了才抓指针：一按下就抓会把 click 目标挪到 orb 上，
         星星就点不动了 */
      if (!d.captured && d.moved > 8) {
        d.captured = true;
        try { orb.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }

      state.yawTarget += dx * 0.0062;
      state.pitchTarget = clamp(state.pitchTarget + dy * 0.0052, -0.85, 0.85);
      /* 平滑一下速度：只看最后一帧的话，手停在快处和慢处甩出去差别会很大 */
      state.vel = state.vel * 0.62 + dx * 0.38;
    }

    function onUp(e) {
      var d = state.drag;
      if (!d || (e && e.pointerId !== d.id)) return;
      if (d.moved > 8) {
        state.dragGuard = performance.now();
        state.spin = clamp(state.vel * 0.34, -5, 5);
        /* 快甩：甩得够猛就召唤一场流星雨，并落下一颗星。
           手机上触摸事件的采样更少、每一帧的位移也小，阈值得放低，
           不然要甩得特别夸张才触发。 */
        var flickNeed = IS_MOBILE ? 13 : 30;
        if (!state.drawing && !state.hero && Math.abs(state.vel) > flickNeed) {
              draw();
        }
      }
      state.drag = null;
      orb.classList.remove('is-dragging');
    }

    function justDragged() {
      return performance.now() - state.dragGuard < 300;
    }

    /* ------------------------------------------------------------ 流星 ---
       spawnMeteor(kind)
         kind 0 —— 平时那种：位置随机、角度随机、短
         kind 1 —— 抽签流星雨：所有流星共用同一个角度（平行），
                   起点在视口之外、沿垂直方向铺满整屏，从边缘切进来
    ------------------------------------------------------------------- */

    function spawnMeteor(kind) {
      if (state.reduced || !meteorsLayer) return;
      var w = state.frame.w;
      var h = state.frame.h;
      var diag = Math.sqrt(w * w + h * h);
      var shower = kind > 0;

      var ang, x, y, travel, len, dur;

      /* 手机上让每一颗活得更久：飞得慢，尾巴停留得长 */
      if (IS_MOBILE) dur *= 2.4;

      if (shower) {
        ang = state.showerAng;
        var rad = (ang * Math.PI) / 180;
        var dx = Math.cos(rad);
        var dy = Math.sin(rad);
        var nx = -dy;          /* 飞行方向的垂线 */
        var ny = dx;

        /* 先沿垂线铺开：这条带宽正好等于视口在该方向上的投影，
           所以流星会从整条边（而不只是角落）切进来 */
        var half = 0.5 * (Math.abs(nx) * w + Math.abs(ny) * h) * 0.94;
        var off = rand(-half, half);
        var ox = state.cx + nx * off;
        var oy = state.cy + ny * off;

        /* 再沿反方向退到「刚好在视口外」：不能退太远，
           否则缓入的动画会让流星前一秒还在屏幕外，看不到「逐渐变多」 */
        var margin = 10;
        var t = 0;
        while (t < 4000) {
          var qx = ox - dx * t;
          var qy = oy - dy * t;
          if (Math.abs(qx - state.cx) > w / 2 + margin ||
              Math.abs(qy - state.cy) > h / 2 + margin) break;
          t += 12;
        }

        x = ox - dx * t;
        y = oy - dy * t;
        /* 走完全屏并对穿出去 */
        travel = t + (Math.abs(dx) * w + Math.abs(dy) * h) * rand(0.94, 1.12);
        len = rand(170, 350);
        dur = rand(1350, 1900);
      } else {
        ang = rand(14, 40);
        var r2 = (ang * Math.PI) / 180;
        x = rand(-w * 0.05, w * 0.7);
        y = rand(-h * 0.02, h * 0.5);
        travel = Math.cos(r2) * rand(w * 0.5, w * 0.85);
        len = rand(90, 190);
        dur = rand(950, 1400);
      }

      var el = document.createElement('span');
      el.className = 'meteor' + (shower ? ' meteor--shower' : '');
      el.style.setProperty('--ang', ang.toFixed(2) + 'deg');
      el.style.setProperty('--travel', px(travel));
      el.style.setProperty('--len', px(len));
      el.style.setProperty('--d', Math.round(dur) + 'ms');
      el.style.transform =
        'translate3d(' + px(x) + ',' + px(y) + ',0) rotate(' + ang.toFixed(2) + 'deg)';

      var run = document.createElement('span');
      run.className = 'meteor__run';
      var trail = document.createElement('span');
      trail.className = 'meteor__trail';
      var head = document.createElement('span');
      head.className = 'meteor__head';
      /* 流星外面裹一圈很大的柔光：跟着它走，划过的地方天就亮一下。
         手机上一场雨 30 多颗，每颗一个 380px 的合成层会把 GPU 撑爆
         （实测：闪屏、抖动、出现矩形接缝），所以手机上不建这层 ——
         星星被照亮的那个效果走的是 JS 光源，不需要它。 */
      trail.setAttribute('aria-hidden', 'true');
      if (!IS_MOBILE) {
        var lightEl = document.createElement('span');
        lightEl.className = 'meteor__light';
        run.appendChild(lightEl);
      }
      run.appendChild(trail);
      run.appendChild(head);
      el.appendChild(run);

      meteorsLayer.appendChild(el);

      /* 把这条流星登记成一盏移动的光：球面上的星会被它照亮 */
      var rad = ang * Math.PI / 180;
      var lightSrc = {
        x: x,
        y: y,
        ax: Math.cos(rad),
        ay: Math.sin(rad),
        len: travel,
        t0: performance.now(),
        dur: dur
      };
      state.lights.push(lightSrc);
      window.setTimeout(function () {
        var li = state.lights.indexOf(lightSrc);
        if (li >= 0) state.lights.splice(li, 1);
      }, dur + 260);

      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, dur + 260);
    }

    /* 流星雨：从稀到密，四段递进（每毫秒落下的颗数 0.019 → 0.046），
       总共约 1.1 秒 32 颗。密度是排出来的，不是随机的 —— 随机看着像噪声。 */
    var SHOWER_PLAN_DESKTOP = [
      [5, 260],
      [7, 300],
      [9, 280],
      [11, 240]
    ];

    /* 手机：数量一颗不少（32 颗），但把时间摊开 3.6 倍 ——
       同一时刻在屏幕上的流星因此少很多，密度下来了，雨的规模不变。 */
    var SHOWER_PLAN_MOBILE = [
      [5, 900],
      [7, 1040],
      [9, 980],
      [11, 860]
    ];

    var SHOWER_PLAN = [];
    function resetShowerPlan() {
      SHOWER_PLAN = IS_MOBILE ? SHOWER_PLAN_MOBILE : SHOWER_PLAN_DESKTOP;
    }
    resetShowerPlan();

    function meteorShower() {
      if (state.reduced) {
        spawnMeteor(1);
        return;
      }
      /* 球往哪边转，流星就往哪边斜 —— 两边是同一个「风」 */
      var base = rand(20, 30);
      state.showerAng = state.spin < -0.12 ? 180 - base : base;

      var at = 0;
      for (var k = 0; k < SHOWER_PLAN.length; k++) {
        var count = SHOWER_PLAN[k][0];
        var span = SHOWER_PLAN[k][1];
        for (var i = 0; i < count; i++) {
          (function (delay) {
            window.setTimeout(function () {
              spawnMeteor(1);
            }, Math.max(0, delay));
          })(at + (span * i) / count + rand(-18, 18));
        }
        at += span;
      }
    }


    /* ------------------------------------------------------- 背景亮点 ---
       偶尔在天上亮一下：复用几个元素，随机位置，1.5 秒化掉。
       手机上少一点、慢一点。 */
    var glints = [];
    var glintTimer = 0;

    function buildGlints() {
      var layer = document.querySelector('.sky__glints');
      if (!layer || glints.length) return;
      var n = IS_MOBILE ? 2 : 4;
      for (var i = 0; i < n; i++) {
        var el = document.createElement('span');
        el.className = 'glint';
        layer.appendChild(el);
        glints.push({ el: el, busy: 0 });
      }
    }

    function spawnGlint() {
      if (state.reduced || !glints.length) return;
      var free = null;
      for (var i = 0; i < glints.length; i++) {
        if (!glints[i].busy) { free = glints[i]; break; }
      }
      if (!free) return;

      /* 位置：40% 落在球体被照亮的那一侧（光和球是一体的），
         其余撒在画面里，避开正中那条字带 */
      var x, y;
      {
        x = rand(0, state.frame.w);
        y = rand(0, state.frame.h);
        if (Math.abs(y - state.frame.h * 0.46) < state.frame.h * 0.09) {
          y += y < state.frame.h * 0.46 ? -70 : 70;
        }
      }

      free.busy = 1;
      free.el.style.setProperty('--gx', Math.round(x) + 'px');
      free.el.style.setProperty('--gy', Math.round(y) + 'px');
      free.el.classList.remove('is-on');
      void free.el.offsetWidth;
      free.el.classList.add('is-on');

      var self = free;
      window.setTimeout(function () {
        self.el.classList.remove('is-on');
        self.busy = 0;
      }, 1600);
    }

    function glintLoop() {
      if (state.reduced) return;
      buildGlints();
      spawnGlint();
      window.clearTimeout(glintTimer);
      glintTimer = window.setTimeout(glintLoop, rand(IS_MOBILE ? 1200 : 620, IS_MOBILE ? 2200 : 1500));
    }

    function meteorLoop() {
      if (state.reduced) return;
      window.setTimeout(function () {
        spawnMeteor(0);
        /* 偶尔连发第二颗，夜空才不像定时器 */
        if (Math.random() < 0.45) {
          window.setTimeout(function () { spawnMeteor(0); }, rand(180, 520));
        }
        meteorLoop();
    glintLoop();
      }, rand(2600, 7000));
    }

    /* -------------------------------------------------------- 抽一颗流星 --- */

    /* 星越多，单颗越小：球面上相邻两点的平均间距 ≈ 2R/√n，
       所以尺寸跟着 1/√n 收。109 颗时桌面单颗核心约 11px、光晕 27px。 */
    function baseSize(n) {
      var w = state.frame.w;
      var h = state.frame.h;
      var narrow = w < 700;
      var density = clamp(Math.sqrt(40 / Math.max(1, n || 1)), 0.4, 1);
      return clamp(
        Math.min(w, h) * (narrow ? 0.032 : 0.024) * density,
        narrow ? 6 : 7,
        narrow ? 16 : 22
      );
    }

    /* 星星的色 → 卡片内部那团光的颜色 */
    var TINT_RGB = {
      gold: '255,215,161',
      cream: '255,241,220',
      rose: '255,182,201',
      sky: '185,212,255'
    };

    var PRESET_TINTS = ['cream', 'cream', 'sky', 'sky', 'gold'];
    var FEATURED_TINTS = ['gold', 'gold', 'gold', 'rose', 'cream'];

    function makeItem(text, kind, birthday) {
      var feat = kind === 'featured';
      return {
        id: 's' + (++seq),
        kind: feat ? 'featured' : 'preset',
        birthday: !!birthday,
        text: text,
        tint: birthday ? 'gold' : pick(feat ? FEATURED_TINTS : PRESET_TINTS),
        unit: birthday ? 1.72 : rand(0.76, 1.3),
        halo: birthday ? 1 : feat ? rand(0.74, 0.96) : rand(0.3, 0.56),
        size: 12,
        phi: 0,
        theta: 0,
        sx: 0,
        sy: 0,
        k: 1,
        front: 0.5,
        el: null
      };
    }

    function setStars(presets, featured, birthdayText) {
      starsLayer.textContent = '';
      state.items = [];
      state.featured = [];
      state.active = null;
      state.pinned = false;
      card.classList.remove('is-open');
      link.classList.remove('is-on');

      var frag = document.createDocumentFragment();
      var list = [];

      /* 亮的先放中间？不：按「暗的在球面均匀铺开、亮的随机插进去」来，
         这样亮星不会全挤在一起 */
      var raw = [];
      for (var p = 0; p < presets.length; p++) {
        if (presets[p]) raw.push({ text: presets[p], kind: 'preset' });
      }
      for (var f = 0; f < featured.length; f++) {
        var fi = featured[f];
        if (!fi) continue;
        if (typeof fi === 'string') raw.push({ text: fi, kind: 'featured' });
        else if (fi.text) raw.push({ text: fi.text, kind: 'featured' });
      }
      /* 生日当天：多一颗最亮的 */
      if (birthdayText) {
        raw.push({ text: birthdayText, kind: 'featured', birthday: true });
        state.birthday = true;
        if (nightEl) nightEl.classList.add('is-birthday');
      }
      /* 打散，免得亮星扎堆 */
      for (var i = raw.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = raw[i]; raw[i] = raw[j]; raw[j] = t;
      }

      var n = raw.length;
      var base = baseSize(n);

      /* 一次插 109 个元素，浏览器要在同一帧里提升 109 个合成层 ——
         软件渲染下那一下就是 800ms 的冻结。分 3 批插入，把成本摊到 3 帧。 */
      var CHUNK = Math.ceil(n / 3);
      var k = 0;
      function batch() {
        var end = Math.min(n, k + CHUNK);
        for (; k < end; k++) {
          var it = makeItem(raw[k].text, raw[k].kind, raw[k].birthday);
          var pt = spherePoint(k, n);
          it.theta = pt.theta + rand(-0.1, 0.1);
          it.phi = phiOf(pt.y) + rand(-0.05, 0.05);
          it.size = base * it.unit * (it.kind === 'featured' ? 1.3 : 1);
          it.el = createStar(it);
          if (it.birthday) it.el.setAttribute('aria-label', it.text);
          state.items.push(it);
          if (it.kind === 'featured') state.featured.push(it);
          frag.appendChild(it.el);
        }
        starsLayer.appendChild(frag);
        frag = document.createDocumentFragment();
        measure();
        render();
        if (k < n) window.requestAnimationFrame(batch);
        else igniteByRadius();
      }
      batch();
    }

    /* 点亮顺序：离球心近的先亮，一圈圈往外开 */
    function igniteByRadius() {
      for (var j = 0; j < state.items.length; j++) {
        var s = state.items[j];
        var d = Math.sqrt(
          Math.pow(s.sx - state.cx, 2) + Math.pow(s.sy - state.cy, 2)
        ) / Math.max(1, state.radius);
        s.el.style.setProperty(
          '--in-delay',
          (0.4 + clamp(d, 0, 1) * 0.85 + rand(0, 0.12)).toFixed(2) + 's'
        );
      }
    }

    function reshuffle() {
      if (!state.items.length) return;
      if (state.hero) heroExit(true);
      hide();
      var n = state.items.length;
      var order = [];
      for (var i = 0; i < n; i++) order.push(i);
      for (var k = order.length - 1; k > 0; k--) {
        var j = Math.floor(Math.random() * (k + 1));
        var t = order[k]; order[k] = order[j]; order[j] = t;
      }
      var base = baseSize(n);
      for (var m = 0; m < n; m++) {
        var item = state.items[m];
        var p = spherePoint(order[m], n);
        tweenTo(item, p.theta + rand(-0.1, 0.1), phiOf(p.y) + rand(-0.05, 0.05), 820);
        item.tint = pick(item.kind === 'featured' ? FEATURED_TINTS : PRESET_TINTS);
        item.unit = rand(0.76, 1.3);
        item.size = base * item.unit * (item.kind === 'featured' ? 1.3 : 1);
        item.el.className =
          'star star--' + item.tint +
          (item.kind === 'featured' ? ' star--featured' : '') +
          (item.live ? ' star--live' : '');
        item.el.style.setProperty('--s', px(item.size));
      }
      spawnMeteor(0);
    }

    /* 抽签：流星雨 → 亮星飞到正中 → 卡片居中出现 */
    /* opts.exclude：这些句子先不抽（已经抽过的）——
       全部抽过之后再从整池重新开始，永远不会「抽不出来」。 */
    function draw(opts) {
      if (state.drawing) return null;
      if (state.hero) heroExit(true);
      if (!state.featured.length) return null;
      hide();
      state.drawing = true;

      /* 球先加速 —— 流星雨和球的旋转是同一阵风 */
      state.spin = clamp(state.spin + 1.25, -5, 5);
      if (dom.galaxy) dom.galaxy.classList.add('is-lit');
      meteorShower();

      /* 池子不再限定在那 24 颗亮星：整片天上的任何一颗都可能被抽中 */
      var all = state.items.filter(function (f) {
        return !f.flying;
      });
      var it = pick(all.length ? all : state.items);
      var ch = cardHeight();
      var box = heroPos(ch);

      var fly = function () {
        state.hero = it;
        it.flying = true;
        /* 记下它在球面上的位置：书签里要画出「这颗星在哪」 */
        it.heroSpot = {
          x: (it.sx - state.cx) / (state.radius || 1),
          y: (it.sy - state.cy) / (state.radius || 1)
        };
        /* 搬到 UI 层：.orb 在抽签时会被模糊，而这一颗必须是最清楚的
           （两层都是 inset:0 的绝对定位，坐标系一样，搬过去不会跳） */
        it.el.classList.add('star--settled');   /* 别再重播入场动画 */
        var ui = card.parentNode;
        if (ui) ui.appendChild(it.el);
        it.el.classList.add('is-hero');
        it.el.style.zIndex = '900';
        it.el.style.opacity = '1';
        /* 自己驱动一段弧线（不用 CSS 过渡）：起点在球面，终点是正中，
           中途往侧上方鼓一下，顺手丢几个渐隐的残影。 */
        it.el.style.transition = 'none';
        var s0 = Math.round((0.55 + 0.92 * it.front) * it.k * 100) / 100;
        var from = { x: it.sx, y: it.sy };
        var to = { x: box.starX, y: box.starY };
        it.el.style.transform =
          'translate3d(' + px(from.x) + ',' + px(from.y) + ',0) scale(' + s0 + ')';
        void it.el.offsetWidth;
        flyArc(it, from, to, s0, 2.6, function () {
          /* 落地：涟漪 + 风铃（音高跟着星在球面上的左右位置） */
          if (dom.ripple) {
            dom.ripple.classList.remove('is-on');
            void dom.ripple.offsetWidth;
            dom.ripple.classList.add('is-on');
          }
          if (dom.onLand) {
            try { dom.onLand(from.x / Math.max(1, state.frame.w)); } catch (e) {}
          }
        });

        textEl.textContent = it.text;
        state.active = it;
        state.pinned = true;
        state.tiltX = 0;
        state.tiltY = 0;
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--w', px(box.w));
        card.style.left = px(box.x);
        card.style.top = px(box.y);
        card.style.setProperty('--ctint', TINT_RGB[it.tint] || '255,215,161');
        card.classList.add('is-open', 'is-hero');
        link.classList.remove('is-on');
        sync();
        setNameClass('is-dim', true);
        /* 景深：球和银河糊掉、压暗，只留这颗星和卡片锐利 */
        if (nightEl) nightEl.classList.add('is-focus');
        if (dom.galaxy) dom.galaxy.classList.remove('is-lit');
        state.drawing = false;
      };

      /* 等流星雨爬到最密的时候再飞星：先密，再有一个「它来了」的瞬间 */
      window.setTimeout(fly, state.reduced ? 40 : 1150);
      return it;
    }


    /* ---------------------------------------------------------- 飞星 ---
       三点二次贝塞尔：起点 → 侧上方的控制点 → 终点。
       沿途每隔几十毫秒在身后留一颗小光点，几百毫秒内淡掉。 */
    var trailPool = [];
    var trailIdx = 0;

    function buildTrail() {
      if (trailPool.length) return;
      for (var i = 0; i < 7; i++) {
        var el = document.createElement('span');
        el.className = 'flytrail';
        card.parentNode.appendChild(el);
        trailPool.push(el);
      }
    }

    function dropTrail(x, y, s) {
      buildTrail();
      var el = trailPool[trailIdx % trailPool.length];
      trailIdx++;
      el.style.transform =
        'translate3d(' + px(x) + ',' + px(y) + ',0) scale(' + s + ')';
      el.classList.remove('is-on');
      void el.offsetWidth;
      el.classList.add('is-on');
    }

    function flyArc(it, from, to, s0, s1, done) {
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      /* 控制点：沿法线方向鼓出去，方向取决于从哪边飞过来 */
      var nx = -dy / len;
      var ny = dx / len;
      var bulge = Math.min(180, len * 0.3) * (dx > 0 ? -1 : 1);
      var cx = (from.x + to.x) / 2 + nx * bulge;
      var cy = (from.y + to.y) / 2 + ny * bulge;

      var t0 = performance.now();
      var DUR = 620;
      var lastTrail = 0;

      function step(now) {
        var p = Math.min(1, (now - t0) / DUR);
        var e = 1 - Math.pow(1 - p, 3);          /* ease-out */
        var m = 1 - e;
        var x = m * m * from.x + 2 * m * e * cx + e * e * to.x;
        var y = m * m * from.y + 2 * m * e * cy + e * e * to.y;
        var s = s0 + (s1 - s0) * e;
        it.el.style.transform =
          'translate3d(' + px(x) + ',' + px(y) + ',0) scale(' +
          (Math.round(s * 100) / 100) + ')';
        if (now - lastTrail > 70) {
          lastTrail = now;
          dropTrail(x, y, Math.round(s * 0.55 * 100) / 100);
        }
        if (p < 1) window.requestAnimationFrame(step);
        else if (done) done();
      }
      window.requestAnimationFrame(step);
    }

    /* 把飞出去的星放回球面（不带动画） */
    function releaseHero(it) {
      it.flying = false;
      if (starsLayer && it.el.parentNode !== starsLayer) starsLayer.appendChild(it.el);
      it.el.classList.remove('is-hero');
      it.el.style.transition = '';
      it.el.style.zIndex = '';
      it.el.style.transform = '';
      it.el.style.opacity = '';
      it._t = null;
      it._o = null;
      it._z = null;
    }

    /* 收起抽签状态。instant=false 时星会先飞回球面再交还给帧循环 */
    function heroExit(instant) {
      var it = state.hero;
      if (!it) return;
      state.hero = null;
      state.active = null;
      state.pinned = false;
      card.classList.remove('is-open', 'is-hero');
      link.classList.remove('is-on');
      setNameClass('is-dim', false);
      if (nightEl) nightEl.classList.remove('is-focus');
      if (dom.galaxy) dom.galaxy.classList.remove('is-lit');
      sync();

      if (instant || state.reduced) { releaseHero(it); return; }

      it.el.style.transform =
        'translate3d(' + px(it.sx) + ',' + px(it.sy) + ',0) scale(' +
        (Math.round((0.55 + 0.92 * it.front) * it.k * 100) / 100) + ')';
      window.setTimeout(function () { releaseHero(it); }, 780);
    }

    function closeHero() { heroExit(false); }

    function relayout() {
      measure();
      buildFields();
      buildDust();
      var n = state.items.length;
      if (n) {
        var base = baseSize(n);
        for (var i = 0; i < n; i++) {
          var it = state.items[i];
          it.size = base * it.unit * (it.kind === 'featured' ? 1.3 : 1);
          it.el.style.setProperty('--s', px(it.size));
        }
      }
      if (state.hero) {
        /* 抽着签时窗口尺寸变了：把星和卡重新摆正 */
        var box = heroPos(cardHeight());
        state.hero.el.style.transform =
          'translate3d(' + px(box.starX) + ',' + px(box.starY) + ',0) scale(2.6)';
        card.style.setProperty('--w', px(box.w));
        card.style.left = px(box.x);
        card.style.top = px(box.y);
      }
      render();
      if (state.active && state.active !== state.hero) {
        state.active.cardH = cardHeight();
        state.card.snap = true;
        followCard();
      }
    }

    function closeAll() { if (state.hero) heroExit(false); hide(); }

    /* ---------------------------------------------------------- 启动 --- */

    measure();
    buildFields();
    buildDust();
    /* 开场：先虚再清，像睁开眼睛（两段跳变，不是连续过渡） */
    if (nightEl && !state.reduced) {
      nightEl.classList.add('is-unveiling');
      window.setTimeout(function () {
        nightEl.classList.remove('is-unveiling');
        nightEl.classList.add('is-unveil2');
      }, 190);
      window.setTimeout(function () {
        nightEl.classList.remove('is-unveil2');
      }, 380);
    }
    state.raf = window.requestAnimationFrame(frame);
    meteorLoop();


    /* 记录指针最后移动的时刻，给悬停预览当闸门 */
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      state.lastMove = performance.now();
    }, { passive: true });

    /* 陀螺仪（安卓无需授权）：以「第一次拿起来的姿态」为基准，
       之后前后左右倾斜 → 卡片最多 ±14°。基准极慢地跟着漂，
       免得手机姿态变了以后卡片一直歪着。桌面没有这个事件，自然走鼠标那套。 */
    (function bindGyro() {
      if (!window.DeviceOrientationEvent || state.reduced) return;
      var base = null;
      window.addEventListener('deviceorientation', function (e) {
        if (e.beta == null || e.gamma == null) return;
        if (!base) base = { b: e.beta, g: e.gamma };
        var db = e.beta - base.b;
        var dg = e.gamma - base.g;
        base.b += db * 0.005;
        base.g += dg * 0.005;
        state.gyroSeen = true;
        state.gyroX = clamp(db * 0.62, -14, 14);
        state.gyroY = clamp(dg * 0.62, -14, 14);
      }, true);
    })();

    document.addEventListener('pointermove', function (e) {
      state.pointerX = e.clientX;
      state.pointerY = e.clientY;
    }, { passive: true });

    orb.addEventListener('pointerdown', onDown, false);
    orb.addEventListener('pointermove', onMove, false);
    orb.addEventListener('pointerup', onUp, false);
    orb.addEventListener('pointercancel', onUp, false);

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(relayout, 200);
    }, false);

    return {
      setStars: setStars,
      draw: draw,
      closeHero: closeHero,
      pin: pin,
      reshuffle: reshuffle,
      relayout: relayout,
      closeAll: closeAll,
      justDragged: justDragged,
      isHero: function () { return !!state.hero; },
      heroSpot: function () { return state.hero ? state.hero.heroSpot : null; },
      /* 书签以这个为准：DOM 里的文字可能被别的东西改过/还没写完 */
      currentVerse: function () { return state.hero ? state.hero.text : ''; },
      state: state
    };
  }

  NS.createSky = createSky;
})(window, document);
