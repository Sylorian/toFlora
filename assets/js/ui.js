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

  function boot() {
    var night = document.querySelector('[data-night]');
    if (!night) return;

    var sky = NS.createSky({
      night: night,
      name: document.querySelector('[data-name]'),
      orb: document.querySelector('[data-orb]'),
      shade: document.querySelector('[data-shade]'),
      draw: document.querySelector('[data-draw]'),
      respin: document.querySelector('[data-shuffle]'),
      dust: document.querySelector('[data-dust]'),
      galaxy: document.querySelector('[data-galaxy]'),
      fieldFar: document.querySelector('[data-field="far"]'),
      fieldNear: document.querySelector('[data-field="near"]'),
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

    var drawBtn = document.querySelector('[data-draw]');
    if (drawBtn) {
      drawBtn.addEventListener('click', function () {
        sky.draw();
      });
    }

    /* ------------------------------------------------------- 重排 --- */

    var respin = document.querySelector('[data-shuffle]');
    if (respin) {
      respin.addEventListener('click', function () {
        sky.reshuffle();
      });
    }

    /* --------------------------------------------------- 开场落款 ---
       只有一句 Sylorian 献给 Flora，2.8 秒后自己淡出；
       点任意处（scrim 铺满全屏）或按 Esc 提前收。                        */

    var intro = document.querySelector('[data-intro]');
    var nameEl = document.querySelector('[data-name]');
    var introDone = false;
    var introTimer = 0;

    function openIntro() {
      if (!intro || introDone) return;
      intro.classList.add('is-open');
      intro.setAttribute('aria-hidden', 'false');
      if (nameEl) nameEl.classList.add('is-away');
      introTimer = window.setTimeout(closeIntro, 2800);
    }

    function closeIntro() {
      if (!intro || introDone) return;
      introDone = true;
      window.clearTimeout(introTimer);
      intro.classList.remove('is-open');
      intro.setAttribute('aria-hidden', 'true');
      if (nameEl) nameEl.classList.remove('is-away');
    }

    if (intro) window.setTimeout(openIntro, 1700);

    /* ------------------------------------------------- 点空白处收起 --- */

    document.addEventListener('click', function (e) {
      if (closest(e.target, '[data-intro-close]')) return;
      if (sky.justDragged && sky.justDragged()) return;
      if (closest(e.target, '[data-draw]')) return;
      if (closest(e.target, '[data-shuffle]')) return;

      /* 抽签状态：点哪儿都收 —— 但点在卡片上不算 */
      if (sky.isHero && sky.isHero()) {
        if (!closest(e.target, '[data-card]')) sky.closeHero();
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
