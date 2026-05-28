'use strict';
/* JARVIS Dashboard — 8 sci-fi widgets matching dashboard.css
   Widgets: clock, stats, weather, core, music, ticker (bar), console, tray
   Wired to: window.JarvisBrain, window.GestureState, window.PowerFeatures */
(function () {
  // ---------- Constants ----------
  var WIDGET_IDS = ['jd-clock', 'jd-stats', 'jd-weather', 'jd-core', 'jd-music', 'jd-console'];
  var LS_POS = 'widget-pos-';
  var LS_HIDDEN = 'widget-hidden-';
  var TRAY_ICONS = {
    'jd-clock':   { label: '⏱', title: 'Chronometer' },
    'jd-stats':   { label: '▦', title: 'System Stats' },
    'jd-weather': { label: '☀', title: 'Weather' },
    'jd-core':    { label: '⬢', title: 'Core' },
    'jd-music':   { label: '♪', title: 'Audio' },
    'jd-console': { label: '▶_', title: 'Console' }
  };
  var DEFAULT_POS = {
    'jd-clock':   { left: '',    top: '60px',  right: '20px', bottom: '' },
    'jd-stats':   { left: '20px',top: '60px',  right: '',     bottom: '' },
    'jd-weather': { left: '',    top: '360px', right: '20px', bottom: '' },
    'jd-core':    { left: '20px',top: '300px', right: '',     bottom: '' },
    'jd-music':   { left: '20px',top: '520px', right: '',     bottom: '' },
    'jd-console': { left: '',    top: '640px', right: '20px', bottom: '' }
  };
  var NEWS_FEED = [
    'STARK INDUSTRIES — Q3 ARC REACTOR OUTPUT UP 42%',
    'GLOBAL HAND-GESTURE STANDARD RATIFIED — ISO/JARVIS-9001',
    'MEDIAPIPE 0.x LANDMARK FIDELITY HITS 98.7% IN LOW LIGHT',
    'AIR-DRAW MODE: NOW WITH RAINBOW PARTICLE PHYSICS',
    'JARVIS ONLINE — ALL SUBSYSTEMS NOMINAL',
    'WEATHER DRONES REPORT CLEAR SKIES OVER MUMBAI',
    'NEURAL INTERFACE LATENCY DROPS BELOW 16ms'
  ];

  // ---------- State ----------
  var widgets = Object.create(null);  // id -> { el, body, parts:{...} }
  var trayEl = null;
  var tickerEl = null;
  var startTime = Date.now();
  var rafId = 0;
  var musicBars = [];
  var lastTick = 0;

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }
  function ce(tag, cls, txt) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt != null) el.textContent = String(txt);
    return el;
  }
  function pad2(n) { n = n | 0; return n < 10 ? '0' + n : '' + n; }
  function fmtTime(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function fmtDate(d) {
    var days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    var mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return days[d.getDay()] + ' ' + pad2(d.getDate()) + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtUptime(secs) {
    secs = secs | 0;
    var h = (secs / 3600) | 0;
    var m = ((secs % 3600) / 60) | 0;
    var s = secs % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  function safeJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---------- Generic widget builder ----------
  function buildWidget(id, title, bodyEl) {
    var w = ce('div', 'jd-widget');
    w.id = id;

    var tb = ce('div', 'jd-titlebar');
    var tt = ce('span', 'jd-title-text', title);
    var btns = ce('div', 'jd-title-btns');
    var minBtn = ce('button', 'jd-title-btn', '_');
    minBtn.type = 'button';
    minBtn.setAttribute('data-action', 'minimize');
    minBtn.setAttribute('aria-label', 'minimize');
    minBtn.addEventListener('click', function (e) { e.stopPropagation(); minimizeWidget(id); });
    var closeBtn = ce('button', 'jd-title-btn close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.setAttribute('aria-label', 'close');
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); minimizeWidget(id); });
    btns.appendChild(minBtn);
    btns.appendChild(closeBtn);
    tb.appendChild(tt);
    tb.appendChild(btns);

    var body = ce('div', 'jd-body');
    if (bodyEl) body.appendChild(bodyEl);

    var c3 = ce('span', 'jd-c3');
    var c4 = ce('span', 'jd-c4');
    var scan = ce('div', 'jd-scan');

    w.appendChild(tb);
    w.appendChild(body);
    w.appendChild(c3);
    w.appendChild(c4);
    w.appendChild(scan);

    attachDrag(w, tb);
    return { el: w, body: body, titlebar: tb };
  }

  // ---------- Drag system ----------
  function attachDrag(widget, handle) {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    function onDown(ev) {
      var tgt = ev.target;
      if (tgt && tgt.classList && (tgt.classList.contains('jd-title-btn') || tgt.classList.contains('close'))) return;
      dragging = true;
      var r = widget.getBoundingClientRect();
      widget.style.left = r.left + 'px';
      widget.style.top = r.top + 'px';
      widget.style.right = '';
      widget.style.bottom = '';
      ox = r.left; oy = r.top;
      sx = ev.clientX; sy = ev.clientY;
      widget.classList.add('jd-dragging');
      ev.preventDefault();
    }
    function onMove(ev) {
      if (!dragging) return;
      var nx = ox + (ev.clientX - sx);
      var ny = oy + (ev.clientY - sy);
      var maxX = window.innerWidth - widget.offsetWidth;
      var maxY = window.innerHeight - widget.offsetHeight;
      if (nx < 0) nx = 0; else if (nx > maxX) nx = maxX;
      if (ny < 0) ny = 0; else if (ny > maxY) ny = maxY;
      widget.style.left = nx + 'px';
      widget.style.top = ny + 'px';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      widget.classList.remove('jd-dragging');
      lsSet(LS_POS + widget.id, JSON.stringify({ left: widget.style.left, top: widget.style.top }));
      bumpInteractions();
    }
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function bumpInteractions() {
    if (window.JarvisBrain && typeof window.JarvisBrain.bump === 'function') {
      window.JarvisBrain.bump('interactions', 1);
    }
  }

  // ---------- Clock widget ----------
  function buildClock() {
    var frag = document.createDocumentFragment();
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'jd-clock-svg');
    svg.setAttribute('width', '140');
    svg.setAttribute('height', '140');
    svg.setAttribute('viewBox', '0 0 100 100');
    // outer ring
    var ringOuter = document.createElementNS(svgNS, 'circle');
    ringOuter.setAttribute('cx', '50'); ringOuter.setAttribute('cy', '50'); ringOuter.setAttribute('r', '46');
    ringOuter.setAttribute('fill', 'none'); ringOuter.setAttribute('stroke', '#00d4ff');
    ringOuter.setAttribute('stroke-width', '1.5'); ringOuter.setAttribute('opacity', '0.7');
    svg.appendChild(ringOuter);
    var ringInner = document.createElementNS(svgNS, 'circle');
    ringInner.setAttribute('cx', '50'); ringInner.setAttribute('cy', '50'); ringInner.setAttribute('r', '38');
    ringInner.setAttribute('fill', 'none'); ringInner.setAttribute('stroke', '#00d4ff');
    ringInner.setAttribute('stroke-width', '0.5'); ringInner.setAttribute('opacity', '0.4');
    svg.appendChild(ringInner);
    // 12 ticks
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      var t = document.createElementNS(svgNS, 'line');
      t.setAttribute('x1', String(50 + Math.cos(a) * 42));
      t.setAttribute('y1', String(50 + Math.sin(a) * 42));
      t.setAttribute('x2', String(50 + Math.cos(a) * 46));
      t.setAttribute('y2', String(50 + Math.sin(a) * 46));
      t.setAttribute('stroke', '#00d4ff'); t.setAttribute('stroke-width', '1.5');
      svg.appendChild(t);
    }
    // hands
    function mkHand(width, length, color) {
      var l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', '50'); l.setAttribute('y1', '50');
      l.setAttribute('x2', '50'); l.setAttribute('y2', String(50 - length));
      l.setAttribute('stroke', color); l.setAttribute('stroke-width', String(width));
      l.setAttribute('stroke-linecap', 'round');
      svg.appendChild(l);
      return l;
    }
    var hH = mkHand(2.5, 22, '#00d4ff');
    var hM = mkHand(1.8, 32, '#00d4ff');
    var hS = mkHand(1, 36, '#00ff88');
    var cap = document.createElementNS(svgNS, 'circle');
    cap.setAttribute('cx', '50'); cap.setAttribute('cy', '50'); cap.setAttribute('r', '3');
    cap.setAttribute('fill', '#00ff88');
    svg.appendChild(cap);

    var digital = ce('div', 'jd-clock-digital', '00:00:00');
    var dateEl = ce('div', 'jd-clock-date', '---');

    frag.appendChild(svg);
    frag.appendChild(digital);
    frag.appendChild(dateEl);

    var wrap = ce('div');
    wrap.appendChild(frag);
    var built = buildWidget('jd-clock', 'CHRONOMETER', wrap);
    built.parts = { hH: hH, hM: hM, hS: hS, digital: digital, dateEl: dateEl };
    return built;
  }

  function tickClock() {
    var w = widgets['jd-clock']; if (!w || !w.parts) return;
    var d = new Date();
    var h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
    var aH = (h + m / 60) / 12 * 360;
    var aM = (m + s / 60) / 60 * 360;
    var aS = s / 60 * 360;
    w.parts.hH.setAttribute('transform', 'rotate(' + aH + ' 50 50)');
    w.parts.hM.setAttribute('transform', 'rotate(' + aM + ' 50 50)');
    w.parts.hS.setAttribute('transform', 'rotate(' + aS + ' 50 50)');
    w.parts.digital.textContent = fmtTime(d);
    w.parts.dateEl.textContent = fmtDate(d);
  }

  // ---------- Stats widget ----------
  function buildStats() {
    var frag = document.createDocumentFragment();
    var rows = [
      { key: 'cpu',          label: 'CPU' },
      { key: 'ram',          label: 'RAM' },
      { key: 'net',          label: 'NET' },
      { key: 'gestures',     label: 'GESTURES' },
      { key: 'interactions', label: 'INTERACTIONS' },
      { key: 'fps',          label: 'FPS' }
    ];
    var refs = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = ce('div', 'jd-stat-row');
      var lbl = ce('div', 'jd-stat-label');
      lbl.appendChild(ce('span', null, r.label));
      var val = ce('span', 'jd-stat-val', '0');
      lbl.appendChild(val);
      var bar = ce('div', 'jd-stat-bar');
      var fill = ce('div', 'jd-stat-fill');
      fill.style.width = '0%';
      bar.appendChild(fill);
      row.appendChild(lbl);
      row.appendChild(bar);
      frag.appendChild(row);
      refs[r.key] = { val: val, fill: fill };
    }
    var wrap = ce('div'); wrap.appendChild(frag);
    var built = buildWidget('jd-stats', 'SYSTEM STATS', wrap);
    built.parts = refs;
    return built;
  }

  function tickStats() {
    var w = widgets['jd-stats']; if (!w || !w.parts) return;
    var brain = window.JarvisBrain;
    var stats = (brain && brain.state && brain.state.stats) || {};
    var gs = window.GestureState || {};
    // synthetic CPU/RAM/NET — wave-driven for the demo, looks alive
    var t = Date.now() / 1000;
    var cpu = Math.round(35 + Math.sin(t * 0.7) * 18 + Math.random() * 8);
    var ram = Math.round(52 + Math.sin(t * 0.3) * 12 + Math.random() * 4);
    var net = Math.round(20 + Math.sin(t * 1.1 + 1.4) * 18 + Math.random() * 10);
    if (cpu < 0) cpu = 0; if (cpu > 100) cpu = 100;
    if (ram < 0) ram = 0; if (ram > 100) ram = 100;
    if (net < 0) net = 0; if (net > 100) net = 100;
    setBar(w.parts.cpu, cpu + '%', cpu);
    setBar(w.parts.ram, ram + '%', ram);
    setBar(w.parts.net, net + '%', net);
    var gCount = stats.gestures | 0;
    var iCount = stats.interactions | 0;
    var fps = (typeof gs.fps === 'number') ? Math.round(gs.fps) : 0;
    setBar(w.parts.gestures, String(gCount), Math.min(100, gCount % 100));
    setBar(w.parts.interactions, String(iCount), Math.min(100, iCount % 100));
    setBar(w.parts.fps, String(fps), Math.min(100, fps * 2));
  }

  function setBar(ref, valText, pct) {
    if (!ref) return;
    if (ref.val) ref.val.textContent = valText;
    if (ref.fill) ref.fill.style.width = pct + '%';
  }

  // ---------- Weather widget ----------
  var WEATHER_ICONS = ['☀','⛅','☁','🌧','⛈','🌤','🌦'];
  var WEATHER_DAYS = ['MON','TUE','WED','THU','FRI'];

  function buildWeather() {
    var frag = document.createDocumentFragment();
    var current = ce('div', 'jd-w-current');
    var icon = ce('div', 'jd-w-icon', '☀');
    var temp = ce('div', 'jd-w-temp', '28°');
    current.appendChild(icon);
    current.appendChild(temp);
    frag.appendChild(current);

    var cond = ce('div', 'jd-w-cond', 'SUNNY • MUMBAI');
    frag.appendChild(cond);

    var meta = ce('div', 'jd-w-meta');
    var humid = ce('span', null, 'HUMID 64%');
    var wind = ce('span', null, 'WIND 12kmh');
    meta.appendChild(humid);
    meta.appendChild(wind);
    frag.appendChild(meta);

    var forecast = ce('div', 'jd-w-forecast');
    var dayRefs = [];
    for (var i = 0; i < WEATHER_DAYS.length; i++) {
      var d = ce('div', 'jd-w-day');
      var dl = ce('div', 'd', WEATHER_DAYS[i]);
      var ic = ce('div', 'ic', WEATHER_ICONS[i % WEATHER_ICONS.length]);
      var tp = ce('div', 't', (24 + (i % 5)) + '°');
      d.appendChild(dl); d.appendChild(ic); d.appendChild(tp);
      forecast.appendChild(d);
      dayRefs.push({ icon: ic, temp: tp });
    }
    frag.appendChild(forecast);

    var wrap = ce('div'); wrap.appendChild(frag);
    var built = buildWidget('jd-weather', 'METEOROLOGY', wrap);
    built.parts = { icon: icon, temp: temp, cond: cond, humid: humid, wind: wind, days: dayRefs };
    return built;
  }

  function tickWeather(now) {
    var w = widgets['jd-weather']; if (!w || !w.parts) return;
    // gently animate every ~5s
    if (now - (w._lastWx || 0) < 5000) return;
    w._lastWx = now;
    var t = Math.round(26 + Math.sin(Date.now() / 60000) * 4);
    w.parts.temp.textContent = t + '°';
    var hum = Math.round(60 + Math.sin(Date.now() / 80000) * 10);
    var wnd = Math.round(10 + Math.abs(Math.sin(Date.now() / 50000)) * 8);
    w.parts.humid.textContent = 'HUMID ' + hum + '%';
    w.parts.wind.textContent = 'WIND ' + wnd + 'kmh';
  }

  // ---------- 3D Core widget ----------
  function buildCore() {
    var stage = ce('div', 'jd-core-stage');
    var cube = ce('div', 'jd-cube');
    var faces = ['JV','RV','◆','◇','⬢','⬡'];
    for (var i = 0; i < 6; i++) {
      var f = ce('div', 'jd-face f' + (i + 1), faces[i]);
      cube.appendChild(f);
    }
    stage.appendChild(cube);
    var built = buildWidget('jd-core', 'POWER CORE', stage);
    built.parts = { stage: stage, cube: cube };
    return built;
  }

  function pulseCore() {
    var w = widgets['jd-core']; if (!w || !w.parts) return;
    w.parts.stage.classList.add('hot');
    setTimeout(function () {
      if (w.parts.stage) w.parts.stage.classList.remove('hot');
    }, 1500);
  }

  // ---------- Music visualizer widget ----------
  function buildMusic() {
    var frag = document.createDocumentFragment();
    var track = ce('div', 'jd-mv-track', '♪ AMBIENT SYSTEM PULSE — TRACK 01');
    var bars = ce('div', 'jd-mv-bars');
    musicBars = [];
    for (var i = 0; i < 24; i++) {
      var b = ce('div', 'jd-mv-bar');
      b.style.height = '10%';
      bars.appendChild(b);
      musicBars.push(b);
    }
    var ctrl = ce('div', 'jd-mv-ctrl');
    function mkBtn(label, onClick) {
      var b = ce('button', 'jd-mv-btn', label);
      b.type = 'button';
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); bumpInteractions(); });
      return b;
    }
    var playing = { v: true };
    var prevBtn = mkBtn('⏮', function () { brainSay('♪ Previous track'); });
    var ppBtn = mkBtn('⏯', function () {
      playing.v = !playing.v;
      brainSay(playing.v ? '♪ Play' : '♪ Pause');
    });
    var nextBtn = mkBtn('⏭', function () { brainSay('♪ Next track'); });
    ctrl.appendChild(prevBtn); ctrl.appendChild(ppBtn); ctrl.appendChild(nextBtn);

    frag.appendChild(track);
    frag.appendChild(bars);
    frag.appendChild(ctrl);
    var wrap = ce('div'); wrap.appendChild(frag);
    var built = buildWidget('jd-music', 'AUDIO MATRIX', wrap);
    built.parts = { track: track, bars: musicBars, playing: playing };
    return built;
  }

  function tickMusic() {
    var w = widgets['jd-music']; if (!w || !w.parts) return;
    var playing = w.parts.playing && w.parts.playing.v;
    var bars = w.parts.bars || [];
    for (var i = 0; i < bars.length; i++) {
      var h;
      if (playing) {
        var freq = 0.4 + (i / bars.length) * 0.8;
        var t = Date.now() / 1000;
        h = 18 + Math.abs(Math.sin(t * freq + i * 0.6)) * 70 + Math.random() * 10;
        if (h > 95) h = 95;
      } else {
        h = 10;
      }
      bars[i].style.height = h + '%';
    }
  }

  // ---------- News ticker (full-width bar) ----------
  function buildTicker() {
    var el = ce('div'); el.id = 'jd-ticker';
    var label = ce('div', 'jd-ticker-label', 'LIVE');
    var track = ce('div', 'jd-ticker-track');
    var inner = ce('div', 'jd-ticker-inner');
    for (var i = 0; i < NEWS_FEED.length; i++) {
      inner.appendChild(ce('span', null, '▸ ' + NEWS_FEED[i]));
    }
    track.appendChild(inner);
    el.appendChild(label);
    el.appendChild(track);
    return { el: el, inner: inner };
  }

  function pushTickerItem(text) {
    if (!tickerEl || !tickerEl.inner) return;
    var s = ce('span', null, '▸ ' + text);
    tickerEl.inner.appendChild(s);
    // trim if too long
    while (tickerEl.inner.childNodes.length > 24) {
      tickerEl.inner.removeChild(tickerEl.inner.firstChild);
    }
  }

  // ---------- AI Console widget ----------
  function buildConsole() {
    var frag = document.createDocumentFragment();
    var log = ce('div', 'jd-cs-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    var row = ce('div', 'jd-cs-input-row');
    var input = ce('input', 'jd-cs-input');
    input.type = 'text';
    input.placeholder = 'Enter command...';
    input.setAttribute('autocomplete', 'off');
    var send = ce('button', 'jd-cs-send', 'SEND');
    send.type = 'button';
    row.appendChild(input);
    row.appendChild(send);
    frag.appendChild(log);
    frag.appendChild(row);
    var wrap = ce('div'); wrap.appendChild(frag);
    var built = buildWidget('jd-console', 'JARVIS CONSOLE', wrap);
    built.parts = { log: log, input: input, send: send };

    function submit() {
      var v = (input.value || '').trim();
      if (!v) return;
      appendConsoleLine('user', v);
      input.value = '';
      bumpInteractions();
      // route the command
      setTimeout(function () { handleConsoleCmd(v); }, 220);
    }
    send.addEventListener('click', function (e) { e.stopPropagation(); submit(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    appendConsoleLine('jarvis', 'System online. Awaiting input.');
    return built;
  }

  function appendConsoleLine(who, text) {
    var w = widgets['jd-console']; if (!w || !w.parts || !w.parts.log) return;
    var log = w.parts.log;
    var line = ce('div', 'jd-cs-line ' + (who === 'user' ? 'user' : 'jarvis'));
    var pfx = ce('span', 'pfx', who === 'user' ? '> ' : 'JARVIS:');
    var msg = ce('span', 'msg', ' ' + text);
    line.appendChild(pfx);
    line.appendChild(msg);
    log.appendChild(line);
    while (log.childNodes.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function handleConsoleCmd(cmd) {
    var lc = cmd.toLowerCase();
    if (lc === 'help' || lc === '?') {
      appendConsoleLine('jarvis', 'Commands: status, reset, draw, screenshot, settings, theme <cyan|green|orange|purple>, god, ping, time, clear');
      return;
    }
    if (lc === 'status') {
      var brain = window.JarvisBrain;
      var st = (brain && brain.state && brain.state.stats) || {};
      appendConsoleLine('jarvis', 'Mode: ' + (brain ? brain.getMode() : '?') + ' • Gestures: ' + (st.gestures | 0) + ' • Interactions: ' + (st.interactions | 0) + ' • Uptime: ' + fmtUptime(st.uptime | 0));
      return;
    }
    if (lc === 'reset') {
      resetLayout();
      appendConsoleLine('jarvis', 'Widget layout reset to defaults.');
      return;
    }
    if (lc === 'draw') {
      if (window.PowerFeatures && window.PowerFeatures.toggleDraw) {
        window.PowerFeatures.toggleDraw();
        appendConsoleLine('jarvis', 'Air-draw toggled.');
      } else appendConsoleLine('jarvis', 'PowerFeatures unavailable.');
      return;
    }
    if (lc === 'screenshot') {
      if (window.PowerFeatures && window.PowerFeatures.screenshot) {
        window.PowerFeatures.screenshot();
        appendConsoleLine('jarvis', 'Screenshot captured.');
      } else appendConsoleLine('jarvis', 'PowerFeatures unavailable.');
      return;
    }
    if (lc === 'settings' || lc === 'config') {
      if (window.PowerFeatures && window.PowerFeatures.openConfig) {
        window.PowerFeatures.openConfig();
        appendConsoleLine('jarvis', 'Config panel opened.');
      } else appendConsoleLine('jarvis', 'PowerFeatures unavailable.');
      return;
    }
    if (lc.indexOf('theme ') === 0) {
      var theme = lc.slice(6).trim();
      if (window.PowerFeatures && window.PowerFeatures.setTheme) {
        window.PowerFeatures.setTheme(theme);
        appendConsoleLine('jarvis', 'Theme → ' + theme);
      } else appendConsoleLine('jarvis', 'PowerFeatures unavailable.');
      return;
    }
    if (lc === 'god') {
      if (window.PowerFeatures && window.PowerFeatures.godMode) {
        window.PowerFeatures.godMode();
        appendConsoleLine('jarvis', '🌈 God mode engaged.');
      } else appendConsoleLine('jarvis', 'PowerFeatures unavailable.');
      return;
    }
    if (lc === 'ping') { appendConsoleLine('jarvis', 'pong'); return; }
    if (lc === 'time') { appendConsoleLine('jarvis', fmtTime(new Date()) + ' • ' + fmtDate(new Date())); return; }
    if (lc === 'clear') {
      var w = widgets['jd-console']; if (w && w.parts && w.parts.log) w.parts.log.textContent = '';
      return;
    }
    appendConsoleLine('jarvis', 'Unknown command. Try "help".');
  }

  // ---------- Tray (minimized icons) ----------
  function buildTray() {
    var el = ce('div'); el.id = 'jd-tray';
    return { el: el };
  }

  function addTrayIcon(id) {
    if (!trayEl || !trayEl.el) return;
    if (trayEl.el.querySelector('[data-widget="' + id + '"]')) return;
    var meta = TRAY_ICONS[id] || { label: '◆', title: id };
    var b = ce('button', 'jd-tray-icon', meta.label);
    b.type = 'button';
    b.setAttribute('data-widget', id);
    b.title = meta.title;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      restoreWidget(id);
      bumpInteractions();
    });
    trayEl.el.appendChild(b);
  }

  function removeTrayIcon(id) {
    if (!trayEl || !trayEl.el) return;
    var icon = trayEl.el.querySelector('[data-widget="' + id + '"]');
    if (icon && icon.parentNode) icon.parentNode.removeChild(icon);
  }

  // ---------- Position + visibility ----------
  function applyDefaultPos(id) {
    var w = widgets[id]; if (!w) return;
    var d = DEFAULT_POS[id] || {};
    w.el.style.left = d.left || '';
    w.el.style.top = d.top || '';
    w.el.style.right = d.right || '';
    w.el.style.bottom = d.bottom || '';
  }

  function restoreState() {
    for (var i = 0; i < WIDGET_IDS.length; i++) {
      var id = WIDGET_IDS[i];
      var w = widgets[id]; if (!w) continue;
      var saved = safeJSON(lsGet(LS_POS + id));
      if (saved && saved.left && saved.top) {
        w.el.style.left = saved.left;
        w.el.style.top = saved.top;
        w.el.style.right = '';
        w.el.style.bottom = '';
      } else {
        applyDefaultPos(id);
      }
      if (lsGet(LS_HIDDEN + id) === 'true') {
        w.el.classList.add('jd-hidden');
        addTrayIcon(id);
      } else {
        w.el.classList.remove('jd-hidden');
        removeTrayIcon(id);
      }
    }
  }

  function minimizeWidget(id) {
    var w = widgets[id]; if (!w) return;
    w.el.classList.add('jd-hidden');
    lsSet(LS_HIDDEN + id, 'true');
    addTrayIcon(id);
    bumpInteractions();
  }

  function restoreWidget(id) {
    var w = widgets[id]; if (!w) return;
    w.el.classList.remove('jd-hidden');
    lsRemove(LS_HIDDEN + id);
    removeTrayIcon(id);
  }

  function resetLayout() {
    for (var i = 0; i < WIDGET_IDS.length; i++) {
      var id = WIDGET_IDS[i];
      lsRemove(LS_POS + id);
      lsRemove(LS_HIDDEN + id);
      var w = widgets[id];
      if (w) {
        w.el.classList.remove('jd-hidden');
        applyDefaultPos(id);
      }
      removeTrayIcon(id);
    }
    brainSay('🔄 Widget layout reset');
  }

  // ---------- Brain wiring ----------
  function brainSay(text) {
    if (window.JarvisBrain && typeof window.JarvisBrain.say === 'function') {
      window.JarvisBrain.say(text);
    }
  }

  function waitForBrain(cb) {
    var tries = 0;
    function poll() {
      if (window.JarvisBrain && typeof window.JarvisBrain.on === 'function') { cb(true); return; }
      tries++;
      if (tries > 60) { cb(false); return; }
      setTimeout(poll, 50);
    }
    poll();
  }

  function wireBrain() {
    var brain = window.JarvisBrain;
    if (!brain) return;
    brain.on('gesture-fired', function (p) {
      if (!p || !p.gesture) return;
      appendConsoleLine('jarvis', 'Gesture detected: ' + p.gesture);
      pushTickerItem('GESTURE ' + p.gesture + ' • CONF ' + ((window.GestureState && window.GestureState.confidence) | 0) + '%');
      pulseCore();
    });
    brain.on('mode-change', function (p) {
      if (!p) return;
      appendConsoleLine('jarvis', 'Mode change: ' + p.from + ' → ' + p.to);
      pushTickerItem('MODE → ' + p.to.toUpperCase());
    });
    brain.on('say', function (p) {
      if (!p || !p.text) return;
      // mirror to ticker if it's a notable say
      var t = String(p.text);
      if (t.indexOf('Gesture:') !== 0) pushTickerItem(t.toUpperCase());
    });
    brain.on('reset', function () {
      appendConsoleLine('jarvis', 'Brain reset complete.');
    });
  }

  // listen for power-features reset signal
  if (typeof document !== 'undefined') {
    document.addEventListener('jarvis:reset-widgets', function () { resetLayout(); });
  }

  // ---------- rAF loop ----------
  function loop() {
    if (typeof document !== 'undefined' && document.hidden) {
      rafId = 0;
      return;
    }
    var now = Date.now();
    if (now - lastTick > 80) {
      lastTick = now;
      tickClock();
      tickStats();
      tickWeather(now);
      tickMusic();
    }
    rafId = requestAnimationFrame(loop);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !rafId) {
        rafId = requestAnimationFrame(loop);
      }
    });
  }

  // ---------- Init ----------
  function mountWidgets() {
    var hud = $('hud') || document.body;
    if (!hud) return;
    // Build each
    widgets['jd-clock']   = buildClock();
    widgets['jd-stats']   = buildStats();
    widgets['jd-weather'] = buildWeather();
    widgets['jd-core']    = buildCore();
    widgets['jd-music']   = buildMusic();
    widgets['jd-console'] = buildConsole();
    // Mount
    for (var i = 0; i < WIDGET_IDS.length; i++) {
      var id = WIDGET_IDS[i];
      if (widgets[id] && widgets[id].el) hud.appendChild(widgets[id].el);
    }
    // Ticker + tray (independent of .jd-widget system)
    tickerEl = buildTicker();
    trayEl = buildTray();
    document.body.appendChild(tickerEl.el);
    document.body.appendChild(trayEl.el);
  }

  function init() {
    mountWidgets();
    restoreState();
    rafId = requestAnimationFrame(loop);
    waitForBrain(function (ok) {
      if (ok) {
        wireBrain();
        brainSay('🖥 Dashboard online');
        pushTickerItem('DASHBOARD ONLINE • 6 WIDGETS ACTIVE');
      } else {
        console.warn('[Dashboard] JarvisBrain not detected after 3s — feed events disabled');
      }
    });
    if (typeof console !== 'undefined' && console.log) {
      console.log('🖥 JARVIS Dashboard online — 8 widgets mounted');
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      setTimeout(init, 0);
    }
  }
})();
