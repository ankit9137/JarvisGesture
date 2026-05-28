'use strict';
/* JARVIS Power Features — particles, air-draw, bursts, macros, config */
(function () {
  var THEMES = { cyan:'#00d4ff', green:'#00ff88', orange:'#ff9d00', purple:'#b066ff' };
  var DEFAULTS = { showLandmarks:false, cursorSmooth:0.18, pinchSensitivity:0.15, soundEffects:true, theme:'cyan', particleCount:80, rainbowDraw:true };
  var LS_KEY = 'jarvis-config';
  function loadConfig() {
    var c = Object.assign({}, DEFAULTS);
    try { var raw = localStorage.getItem(LS_KEY); if (raw) { var p = JSON.parse(raw); for (var k in DEFAULTS) if (p[k] !== undefined) c[k] = p[k]; } } catch (e) {}
    return c;
  }
  function saveConfig() { try { localStorage.setItem(LS_KEY, JSON.stringify(window.GestureConfig)); } catch (e) {} }
  function applyTheme(name) {
    if (!THEMES[name]) name = 'cyan';
    window.GestureConfig.theme = name;
    document.documentElement.style.setProperty('--blue', THEMES[name]);
    saveConfig();
  }
  window.GestureConfig = loadConfig();
  var audioCtx = null;
  function getCtx() {
    if (audioCtx) return audioCtx;
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } catch (e) {}
    return audioCtx;
  }
  function tone(freq, dur, type, gain) {
    var ctx = getCtx(); if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.value = gain || 0.15;
    o.connect(g); g.connect(ctx.destination);
    var t = ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
  window.JarvisSFX = { play: function (name) {
    if (!window.GestureConfig.soundEffects) return;
    var ctx = getCtx(); if (!ctx) return;
    if (name === 'click') tone(800, 0.05, 'square', 0.12);
    else if (name === 'switch') {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(400, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
      g.gain.value = 0.15;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.25);
    } else if (name === 'boot') { tone(523.25, 0.6, 'sine', 0.10); tone(659.25, 0.6, 'sine', 0.10); tone(783.99, 0.6, 'sine', 0.10); }
    else if (name === 'error') tone(200, 0.3, 'sawtooth', 0.15);
  } };
  var gBuf = [];
  function pushGesture(g) { gBuf.push(g || 'NONE'); if (gBuf.length > 5) gBuf.shift(); }
  function currentStable() {
    if (!gBuf.length) return 'NONE';
    var counts = {}, best = gBuf[0], bestN = 0;
    for (var i = 0; i < gBuf.length; i++) {
      var k = gBuf[i];
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    }
    return best;
  }
  function detectPinkyUp() {
    var s = window.GestureState; if (!s || !s.fingersUp) return false;
    var f = s.fingersUp;
    return f[4] === true && !f[0] && !f[1] && !f[2] && !f[3];
  }
  function mk(tag, id, cls) {
    var e = document.createElement(tag);
    if (id) e.id = id; if (cls) e.className = cls;
    return e;
  }
  function getBlue() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim();
      return v || THEMES[window.GestureConfig.theme] || '#00d4ff';
    } catch (e) { return '#00d4ff'; }
  }
  var pCanvas, pCtx, particles = [], pRunning = true, pRAF = 0;
  function initParticles() {
    pCanvas = mk('canvas', 'pf-particles');
    document.body.appendChild(pCanvas);
    pCtx = pCanvas.getContext('2d');
    resizeParticles(); rebuildParticles();
  }
  function resizeParticles() {
    if (!pCanvas) return;
    pCanvas.width = window.innerWidth; pCanvas.height = window.innerHeight;
  }
  function rebuildParticles() {
    var n = window.GestureConfig.particleCount | 0;
    if (n < 20) n = 20; if (n > 200) n = 200;
    particles = [];
    for (var i = 0; i < n; i++) {
      particles.push({ x: Math.random() * pCanvas.width, y: Math.random() * pCanvas.height, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, size: 1 + Math.random() * 2 });
    }
  }
  function particleColor(i, t) {
    if (drawActive) return 'hsl(' + ((t * 0.05 + i * 4) % 360) + ',80%,60%)';
    if (currentStable() === 'PEACE') return '#00ff88';
    return getBlue();
  }
  function drawParticles(t) {
    if (!pCtx) return;
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    var s = window.GestureState;
    var tip = (s && s.indexTip) ? s.indexTip : null;
    var hasHand = !!tip && s.gesture !== 'NONE';
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (hasHand) {
        var dx = tip.x - p.x, dy = tip.y - p.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1 && d < 400) {
          var f = 0.04 / d;
          p.vx += dx * f; p.vy += dy * f;
          if (p.vx > 2) p.vx = 2; if (p.vx < -2) p.vx = -2;
          if (p.vy > 2) p.vy = 2; if (p.vy < -2) p.vy = -2;
        }
      } else { p.vx *= 0.99; p.vy *= 0.99; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = pCanvas.width; else if (p.x > pCanvas.width) p.x = 0;
      if (p.y < 0) p.y = pCanvas.height; else if (p.y > pCanvas.height) p.y = 0;
    }
    for (var a = 0; a < particles.length; a++) {
      for (var b = a + 1; b < particles.length; b++) {
        var p1 = particles[a], p2 = particles[b];
        var ddx = p1.x - p2.x, ddy = p1.y - p2.y;
        var dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < 120) {
          pCtx.save();
          pCtx.strokeStyle = particleColor(a, t);
          pCtx.globalAlpha = (1 - dist / 120) * 0.4;
          pCtx.lineWidth = 0.5;
          pCtx.beginPath();
          pCtx.moveTo(p1.x, p1.y); pCtx.lineTo(p2.x, p2.y); pCtx.stroke();
          pCtx.restore();
        }
      }
    }
    for (var j = 0; j < particles.length; j++) {
      var q = particles[j];
      pCtx.save();
      pCtx.fillStyle = particleColor(j, t);
      pCtx.globalAlpha = 0.7;
      pCtx.beginPath();
      pCtx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      pCtx.fill();
      pCtx.restore();
    }
  }
  var dCanvas, dCtx, drawActive = false, strokes = [], curStroke = null;
  var openPalmStartMs = 0, drawBadge = null;
  function initDraw() {
    dCanvas = mk('canvas', 'air-draw-canvas');
    document.body.appendChild(dCanvas);
    dCtx = dCanvas.getContext('2d');
    resizeDraw();
  }
  function resizeDraw() {
    if (!dCanvas) return;
    dCanvas.width = window.innerWidth; dCanvas.height = window.innerHeight;
    redrawStrokes();
  }
  function strokeColor(t) {
    return window.GestureConfig.rainbowDraw ? 'hsl(' + ((t * 0.1) % 360) + ',90%,60%)' : getBlue();
  }
  function enterDraw() {
    if (drawActive) return;
    drawActive = true;
    if (dCanvas) dCanvas.classList.add('pf-active');
    if (drawBadge) drawBadge.classList.add('pf-show');
    if (window.JarvisBrain && window.JarvisBrain.setMode) window.JarvisBrain.setMode('draw');
    window.JarvisSFX.play('switch');
  }
  function exitDraw() {
    if (!drawActive) return;
    drawActive = false;
    if (dCanvas) dCanvas.classList.remove('pf-active');
    if (drawBadge) drawBadge.classList.remove('pf-show');
    curStroke = null;
    if (window.JarvisBrain && window.JarvisBrain.setMode) window.JarvisBrain.setMode('idle');
    window.JarvisSFX.play('switch');
  }
  function clearDraw() {
    if (!dCtx) { strokes = []; return; }
    var fadeStart = performance.now();
    function fade() {
      var p = (performance.now() - fadeStart) / 400;
      if (p >= 1) { strokes = []; curStroke = null; dCtx.clearRect(0, 0, dCanvas.width, dCanvas.height); return; }
      dCtx.save();
      dCtx.globalAlpha = 1 - p;
      dCtx.clearRect(0, 0, dCanvas.width, dCanvas.height);
      redrawStrokes(1 - p);
      dCtx.restore();
      requestAnimationFrame(fade);
    }
    fade();
  }
  function redrawStrokes(alpha) {
    if (!dCtx) return;
    dCtx.clearRect(0, 0, dCanvas.width, dCanvas.height);
    for (var i = 0; i < strokes.length; i++) drawStroke(strokes[i], alpha);
    if (curStroke) drawStroke(curStroke, alpha);
  }
  function drawStroke(stroke, alpha) {
    var pts = stroke.points;
    if (!pts || pts.length < 2) return;
    dCtx.save();
    dCtx.strokeStyle = stroke.color;
    dCtx.shadowBlur = 15;
    dCtx.shadowColor = stroke.color;
    dCtx.lineCap = 'round';
    dCtx.lineJoin = 'round';
    dCtx.lineWidth = 4;
    if (alpha !== undefined) dCtx.globalAlpha = alpha;
    dCtx.beginPath();
    dCtx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var midX = (pts[i].x + pts[i + 1].x) / 2;
      var midY = (pts[i].y + pts[i + 1].y) / 2;
      dCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    if (pts.length >= 2) dCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    dCtx.stroke();
    dCtx.restore();
  }
  function updateDraw(t) {
    var s = window.GestureState; if (!s) return;
    var stable = currentStable();
    var pinky = detectPinkyUp();
    if (!drawActive && (pinky || stable === 'POINT_SIDE')) enterDraw();
    else if (drawActive && stable === 'FIST') { exitDraw(); openPalmStartMs = 0; return; }
    if (!drawActive) return;
    if (stable === 'OPEN_PALM') {
      if (!openPalmStartMs) openPalmStartMs = t;
      else if (t - openPalmStartMs >= 2000) { clearDraw(); openPalmStartMs = 0; }
    } else openPalmStartMs = 0;
    var indexExt = s.fingersUp && s.fingersUp[1] === true;
    if ((stable === 'INDEX_UP' || pinky) && indexExt && s.indexTip) {
      if (!curStroke) { curStroke = { points: [], color: strokeColor(t) }; strokes.push(curStroke); }
      var pt = { x: s.indexTip.x, y: s.indexTip.y };
      var last = curStroke.points[curStroke.points.length - 1];
      if (!last || Math.abs(last.x - pt.x) > 1 || Math.abs(last.y - pt.y) > 1) curStroke.points.push(pt);
    } else curStroke = null;
    redrawStrokes();
  }
  function burst(emoji, x, y) {
    if (x == null || y == null) return;
    for (var i = 0; i < 12; i++) {
      var span = document.createElement('span');
      span.className = 'pf-burst';
      span.textContent = emoji;
      var ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.3;
      var rad = 60 + Math.random() * 60;
      span.style.left = x + 'px'; span.style.top = y + 'px';
      span.style.setProperty('--dx', Math.cos(ang) * rad + 'px');
      span.style.setProperty('--dy', Math.sin(ang) * rad + 'px');
      document.body.appendChild(span);
      (function (el) { setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 1500); })(span);
    }
  }
  function handleBurstFor(g) {
    var s = window.GestureState; var tip = (s && s.indexTip) ? s.indexTip : null;
    if (!tip) return;
    if (g === 'THUMBS_UP') burst('👍', tip.x, tip.y);
    else if (g === 'OK') burst('✓', tip.x, tip.y);
    else if (g === 'ROCK') burst('🔥', tip.x, tip.y);
  }
  var sequence = [], lastSeqMs = 0, macroTrail = null;
  var macros = {
    konami:     { pattern: ['FIST','OPEN_PALM','FIST','OPEN_PALM','OK'], handler: function(){ godMode(); } },
    screenshot: { pattern: ['PEACE','OK'], handler: function(){ takeScreenshot(); } },
    reset:      { pattern: ['PINKY_UP','THUMBS_UP','FIST'], handler: function(){ resetWidgets(); } }
  };
  function matchTail(pattern) {
    if (pattern.length > sequence.length) return false;
    var off = sequence.length - pattern.length;
    for (var i = 0; i < pattern.length; i++) if (sequence[off + i] !== pattern[i]) return false;
    return true;
  }
  function addToSequence(g, t) {
    if (t - lastSeqMs > 3000) sequence = [];
    sequence.push(g);
    if (sequence.length > 10) sequence.shift();
    lastSeqMs = t;
    renderTrail();
    for (var name in macros) {
      if (matchTail(macros[name].pattern)) {
        try { macros[name].handler(); } catch (e) { console.warn('macro', name, e); }
        sequence = []; renderTrail(); break;
      }
    }
  }
  var LABELS = { FIST:'✊', OPEN_PALM:'✋', PINCH:'🤏', OK:'OK', INDEX_UP:'☝', PEACE:'✌', ROCK:'🤘', THUMBS_UP:'👍', THREE:'3', FOUR:'4', PINKY_UP:'🤙' };
  function renderTrail() {
    if (!macroTrail) return;
    while (macroTrail.firstChild) macroTrail.removeChild(macroTrail.firstChild);
    if (!sequence.length) { macroTrail.classList.remove('pf-show'); return; }
    macroTrail.classList.add('pf-show');
    for (var i = 0; i < sequence.length; i++) {
      var step = mk('span', null, 'pf-step');
      var nm = mk('span', null, 'pf-name');
      nm.textContent = LABELS[sequence[i]] || sequence[i];
      step.appendChild(nm);
      macroTrail.appendChild(step);
      if (i < sequence.length - 1) { var ar = mk('span', null, 'pf-arrow'); ar.textContent = '→'; macroTrail.appendChild(ar); }
    }
  }
  window.GestureMacros = {
    record: function (name, pattern, handler) {
      if (!name || !pattern || !pattern.length || typeof handler !== 'function') return;
      macros[name] = { pattern: pattern.slice(), handler: handler };
    },
    play: function (name) {
      if (macros[name]) { try { macros[name].handler(); } catch (e) { console.warn(e); } }
    },
    list: function () { return Object.keys(macros); }
  };
  function godMode() {
    document.body.classList.add('pf-god-mode');
    window.JarvisSFX.play('boot');
    if (window.JarvisBrain && window.JarvisBrain.say) window.JarvisBrain.say('🌈 GOD MODE engaged');
    setTimeout(function () { document.body.classList.remove('pf-god-mode'); }, 10000);
  }
  function takeScreenshot() {
    if (typeof window.html2canvas !== 'function') { window.JarvisSFX.play('error'); console.warn('html2canvas not available'); return; }
    try {
      window.html2canvas(document.body).then(function (canvas) {
        canvas.toBlob(function (blob) {
          if (!blob) { window.JarvisSFX.play('error'); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'jarvis-' + Date.now() + '.png';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 100);
          if (window.JarvisBrain && window.JarvisBrain.say) window.JarvisBrain.say('📸 Screenshot saved');
        });
      }).catch(function (e) { window.JarvisSFX.play('error'); console.warn('screenshot failed', e); });
    } catch (e) { window.JarvisSFX.play('error'); console.warn('screenshot exception', e); }
  }
  function resetWidgets() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('widget-pos-') === 0) keys.push(k); }
      for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
    } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('jarvis:reset-widgets')); } catch (e) {}
    window.JarvisSFX.play('switch');
    if (window.JarvisBrain && window.JarvisBrain.say) window.JarvisBrain.say('🔄 Widgets reset');
  }
  var modal = null, gear = null;
  function buildGear() {
    gear = mk('button', 'pf-gear');
    gear.type = 'button'; gear.setAttribute('aria-label', 'Open JARVIS config'); gear.textContent = '⚙';
    gear.addEventListener('click', function () { window.JarvisSFX.play('click'); openModal(); });
    document.body.appendChild(gear);
  }
  function buildModal() {
    modal = mk('div', 'pf-modal');
    var panel = mk('div', null, 'pf-panel');
    var h = document.createElement('h3'); h.textContent = 'JARVIS CONFIG'; panel.appendChild(h);
    function row(label, control, valSpan) {
      var r = mk('div', null, 'pf-row');
      var l = document.createElement('label'); l.textContent = label; r.appendChild(l);
      r.appendChild(control); if (valSpan) r.appendChild(valSpan);
      return r;
    }
    function chk(id) { var i = document.createElement('input'); i.type = 'checkbox'; i.id = id; return i; }
    function rng(id, min, max) { var i = document.createElement('input'); i.type = 'range'; i.id = id; i.min = String(min); i.max = String(max); return i; }
    function val(id) { return mk('span', id, 'pf-val'); }
    var cfg = window.GestureConfig;
    var cb1 = chk('cfg-landmarks'); cb1.checked = !!cfg.showLandmarks;
    cb1.onchange = function () { cfg.showLandmarks = cb1.checked; saveConfig(); };
    panel.appendChild(row('Show landmarks', cb1));
    var r1 = rng('cfg-smooth', 5, 50); r1.value = String(Math.round(cfg.cursorSmooth * 100));
    var v1 = val('val-smooth'); v1.textContent = cfg.cursorSmooth.toFixed(2);
    r1.oninput = function () { cfg.cursorSmooth = (+r1.value) / 100; v1.textContent = cfg.cursorSmooth.toFixed(2); saveConfig(); };
    panel.appendChild(row('Cursor smoothness', r1, v1));
    var r2 = rng('cfg-pinch', 5, 30); r2.value = String(Math.round(cfg.pinchSensitivity * 100));
    var v2 = val('val-pinch'); v2.textContent = cfg.pinchSensitivity.toFixed(2);
    r2.oninput = function () { cfg.pinchSensitivity = (+r2.value) / 100; v2.textContent = cfg.pinchSensitivity.toFixed(2); saveConfig(); };
    panel.appendChild(row('Pinch sensitivity', r2, v2));
    var cb2 = chk('cfg-sound'); cb2.checked = !!cfg.soundEffects;
    cb2.onchange = function () { cfg.soundEffects = cb2.checked; saveConfig(); };
    panel.appendChild(row('Sound effects', cb2));
    var r3 = rng('cfg-particles', 20, 200); r3.value = String(cfg.particleCount);
    var v3 = val('val-particles'); v3.textContent = String(cfg.particleCount);
    r3.oninput = function () { cfg.particleCount = +r3.value; v3.textContent = String(cfg.particleCount); saveConfig(); rebuildParticles(); };
    panel.appendChild(row('Particle count', r3, v3));
    var themeRow = mk('div', null, 'pf-row');
    var tl = document.createElement('label'); tl.textContent = 'Theme'; themeRow.appendChild(tl);
    var themeWrap = mk('div', null, 'pf-theme'), swatches = [];
    Object.keys(THEMES).forEach(function (name) {
      var b = mk('button', null, 'pf-swatch');
      b.type = 'button'; b.setAttribute('data-theme', name); b.style.background = THEMES[name];
      if (cfg.theme === name) b.classList.add('pf-on');
      b.onclick = function () {
        applyTheme(name);
        for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('pf-on');
        b.classList.add('pf-on'); window.JarvisSFX.play('click');
      };
      swatches.push(b); themeWrap.appendChild(b);
    });
    themeRow.appendChild(themeWrap); panel.appendChild(themeRow);
    var actions = mk('div', null, 'pf-actions');
    var two = mk('button', 'pf-twohands');
    two.type = 'button'; two.textContent = 'Enable Two-Hand Mode';
    two.onclick = function () {
      window.JarvisSFX.play('error');
      console.warn('Two-hand mode: Coming soon — requires gesture engine v2');
      if (window.JarvisBrain && window.JarvisBrain.say) window.JarvisBrain.say('Two-hand mode: coming soon');
    };
    actions.appendChild(two);
    var rst = mk('button', 'pf-reset');
    rst.type = 'button'; rst.textContent = 'Reset to defaults';
    rst.onclick = function () {
      window.GestureConfig = Object.assign({}, DEFAULTS);
      saveConfig(); applyTheme(DEFAULTS.theme); rebuildParticles();
      cb1.checked = DEFAULTS.showLandmarks; cb2.checked = DEFAULTS.soundEffects;
      r1.value = String(Math.round(DEFAULTS.cursorSmooth * 100)); v1.textContent = DEFAULTS.cursorSmooth.toFixed(2);
      r2.value = String(Math.round(DEFAULTS.pinchSensitivity * 100)); v2.textContent = DEFAULTS.pinchSensitivity.toFixed(2);
      r3.value = String(DEFAULTS.particleCount); v3.textContent = String(DEFAULTS.particleCount);
      for (var i = 0; i < swatches.length; i++) swatches[i].classList.toggle('pf-on', swatches[i].getAttribute('data-theme') === DEFAULTS.theme);
      window.JarvisSFX.play('click');
    };
    actions.appendChild(rst);
    panel.appendChild(actions);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('pf-show')) closeModal(); });
  }
  function openModal() { if (modal) modal.classList.add('pf-show'); }
  function closeModal() { if (modal) modal.classList.remove('pf-show'); }
  window.PowerFeatures = {
    enableTwoHands: function () { console.warn('Two-hand mode not yet implemented'); return false; },
    setTheme: function (name) { applyTheme(name); },
    openConfig: function () { openModal(); },
    closeConfig: function () { closeModal(); },
    screenshot: function () { takeScreenshot(); },
    godMode: function () { godMode(); },
    toggleDraw: function () { if (drawActive) exitDraw(); else enterDraw(); }
  };
  var lastStable = 'NONE';
  function tick(t) {
    if (window.GestureState) {
      pushGesture(window.GestureState.gesture);
      var stable = currentStable();
      if (stable !== lastStable) {
        handleBurstFor(stable);
        if (stable !== 'NONE' && stable !== 'UNKNOWN') addToSequence(stable, t);
        lastStable = stable;
      }
      updateDraw(t);
    }
    if (pRunning) drawParticles(t);
    pRAF = requestAnimationFrame(tick);
  }
  function init() {
    applyTheme(window.GestureConfig.theme);
    initParticles(); initDraw();
    drawBadge = mk('div', 'pf-draw-badge');
    drawBadge.appendChild(mk('span', null, 'pf-dot'));
    var lbl = document.createElement('span'); lbl.textContent = ' DRAW MODE';
    drawBadge.appendChild(lbl);
    document.body.appendChild(drawBadge);
    macroTrail = mk('div', 'pf-macro-trail');
    document.body.appendChild(macroTrail);
    buildGear(); buildModal();
    window.addEventListener('resize', function () { resizeParticles(); resizeDraw(); rebuildParticles(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { pRunning = false; if (pRAF) cancelAnimationFrame(pRAF); pRAF = 0; }
      else if (!pRunning) { pRunning = true; if (!pRAF) pRAF = requestAnimationFrame(tick); }
    });
    pRAF = requestAnimationFrame(tick);
    console.log('⚡ JARVIS Power Features online — gestures: PINKY_UP draw, PEACE+OK shot, FIST+OPEN_PALM+FIST+OPEN_PALM+OK god mode');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
