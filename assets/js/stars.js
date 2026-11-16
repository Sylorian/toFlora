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
      hold: false,
      reduced: reduced(),

      hero: null,           /* 抽中的那颗星 */
      drawing: false,

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
      [dom.draw, dom.respin].forEach(function (el) {
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width && r.height) state.avoid.push(r);
      });
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
      var count = w < 700 ? 80 : 170;
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

        var t =
          'translate3d(' + px(it.sx) + ',' + px(it.sy) + ',0) scale(' +
          (Math.round(scale * 1000) / 1000) + ')';
        if (it._t !== t) { it.el.style.transform = t; it._t = t; }

        var o = Math.round(op * 100) / 100;
        if (it._o !== o) { it.el.style.opacity = o; it._o = o; }

        var z = Math.round(f * 200);
        if (it._z !== z) { it.el.style.zIndex = z; it._z = z; }
      }

      if (state.active && state.active !== state.hero) {
        if (state.active.front < MIN_FRONT) hide();
        else followCard();
      }
    }

    /* ------------------------------------------------------------ 帧循环 --- */

    function frame(now) {
      state.raf = window.requestAnimationFrame(frame);
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
        var cruise = state.reduced || state.hold || state.hero ? 0 : BASE_SPIN * breathe;

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
      it.live = it.kind === 'featured' || Math.random() < 0.42;
      b.className =
        'star star--' + it.tint +
        (it.kind === 'featured' ? ' star--featured' : '') +
        (it.live ? ' star--live' : '');
      b.setAttribute('data-star', it.id);
      b.setAttribute('aria-label', String(it.text).slice(0, 40));

      b.style.setProperty('--halo', it.halo.toFixed(2));
      b.style.setProperty('--tw-dur', rand(3.4, 7.6).toFixed(2) + 's');
      b.style.setProperty('--tw-delay', (-rand(0, 7)).toFixed(2) + 's');
      b.style.setProperty('--s', px(it.size));

      var body = span('star__body');
      body.appendChild(span('star__halo'));
      body.appendChild(span('star__core'));
      body.appendChild(span('star__spark'));
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
      card.classList.add('is-open');
      sync();
      followCard();
      return it;
    }

    function hide() {
      cancelClose();
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
      run.appendChild(trail);
      run.appendChild(head);
      el.appendChild(run);

      meteorsLayer.appendChild(el);
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, dur + 260);
    }

    /* 流星雨：从稀到密，四段递进（每毫秒落下的颗数 0.019 → 0.046），
       总共约 1.1 秒 32 颗。密度是排出来的，不是随机的 —— 随机看着像噪声。 */
    var SHOWER_PLAN = [
      [5, 260],
      [7, 300],
      [9, 280],
      [11, 240]
    ];

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

    function meteorLoop() {
      if (state.reduced) return;
      window.setTimeout(function () {
        spawnMeteor(0);
        /* 偶尔连发第二颗，夜空才不像定时器 */
        if (Math.random() < 0.45) {
          window.setTimeout(function () { spawnMeteor(0); }, rand(180, 520));
        }
        meteorLoop();
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

    var PRESET_TINTS = ['cream', 'cream', 'sky', 'sky', 'gold'];
    var FEATURED_TINTS = ['gold', 'gold', 'gold', 'rose', 'cream'];

    function makeItem(text, kind) {
      var feat = kind === 'featured';
      return {
        id: 's' + (++seq),
        kind: feat ? 'featured' : 'preset',
        text: text,
        tint: pick(feat ? FEATURED_TINTS : PRESET_TINTS),
        unit: rand(0.76, 1.3),
        halo: feat ? rand(0.74, 0.96) : rand(0.3, 0.56),
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

    function setStars(presets, featured) {
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
        if (featured[f]) raw.push({ text: featured[f], kind: 'featured' });
      }
      /* 打散，免得亮星扎堆 */
      for (var i = raw.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = raw[i]; raw[i] = raw[j]; raw[j] = t;
      }

      var n = raw.length;
      var base = baseSize(n);
      for (var k = 0; k < n; k++) {
        var it = makeItem(raw[k].text, raw[k].kind);
        var pt = spherePoint(k, n);
        it.theta = pt.theta + rand(-0.1, 0.1);
        it.phi = phiOf(pt.y) + rand(-0.05, 0.05);
        it.size = base * it.unit * (it.kind === 'featured' ? 1.3 : 1);
        it.el = createStar(it);
        state.items.push(it);
        if (it.kind === 'featured') state.featured.push(it);
        frag.appendChild(it.el);
      }
      starsLayer.appendChild(frag);

      measure();
      render();
      igniteByRadius();
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
    function draw() {
      if (state.drawing) return;
      if (state.hero) heroExit(true);
      if (!state.featured.length) return;
      hide();
      state.drawing = true;
      /* 球先加速 —— 流星雨和球的旋转是同一阵风 */
      state.spin = clamp(state.spin + 1.25, -5, 5);
      meteorShower();

      var it = pick(state.featured);
      var ch = cardHeight();
      var box = heroPos(ch);

      var fly = function () {
        state.hero = it;
        it.flying = true;
        it.el.classList.add('is-hero');
        it.el.style.zIndex = '900';
        it.el.style.opacity = '1';
        /* 先无过渡地放到它此刻的位置，下一帧再改成中心 → 一条飞过去的轨迹 */
        it.el.style.transition = 'none';
        it.el.style.transform =
          'translate3d(' + px(it.sx) + ',' + px(it.sy) + ',0) scale(' +
          (Math.round((0.55 + 0.92 * it.front) * it.k * 100) / 100) + ')';
        void it.el.offsetWidth;                 /* 强制回流，让上面这帧生效 */
        it.el.style.transition = '';
        it.el.style.transform =
          'translate3d(' + px(box.starX) + ',' + px(box.starY) + ',0) scale(2.6)';

        textEl.textContent = it.text;
        state.active = it;
        state.pinned = true;
        card.classList.add('is-open', 'is-hero');
        card.style.setProperty('--w', px(box.w));
        card.style.left = px(box.x);
        card.style.top = px(box.y);
        link.classList.remove('is-on');
        sync();
        if (dom.name) dom.name.classList.add('is-dim');
        if (dom.draw) dom.draw.classList.add('is-drawing');
        state.drawing = false;
        setDrawLabel('再抽一颗');
      };

      /* 等流星雨爬到最密的时候再飞星：先密，再有一个「它来了」的瞬间 */
      window.setTimeout(fly, state.reduced ? 40 : 1150);
    }

    /* 把飞出去的星放回球面（不带动画） */
    function releaseHero(it) {
      it.flying = false;
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
      if (dom.name) dom.name.classList.remove('is-dim');
      if (dom.draw) dom.draw.classList.remove('is-drawing');
      setDrawLabel('抽一颗流星');
      sync();

      if (instant || state.reduced) { releaseHero(it); return; }

      it.el.style.transform =
        'translate3d(' + px(it.sx) + ',' + px(it.sy) + ',0) scale(' +
        (Math.round((0.55 + 0.92 * it.front) * it.k * 100) / 100) + ')';
      window.setTimeout(function () { releaseHero(it); }, 780);
    }

    function setDrawLabel(text) {
      var el = dom.draw && dom.draw.querySelector('.draw__label');
      if (el) el.textContent = text;
    }

    function closeHero() { heroExit(false); }

    function relayout() {
      measure();
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

    function hold(on) { state.hold = !!on; }
    function closeAll() { if (state.hero) heroExit(false); hide(); }

    /* ---------------------------------------------------------- 启动 --- */

    measure();
    buildDust();
    state.raf = window.requestAnimationFrame(frame);
    meteorLoop();

    /* 记录指针最后移动的时刻，给悬停预览当闸门 */
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      state.lastMove = performance.now();
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
      hold: hold,
      justDragged: justDragged,
      isHero: function () { return !!state.hero; },
      state: state
    };
  }

  NS.createSky = createSky;
})(window, document);
