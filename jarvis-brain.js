'use strict';
/* JARVIS Brain — central state + event bus for the JARVIS Gesture web app */
(function () {
  // ---------- Constants ----------
  var STABLE_BUFFER_SIZE = 5;
  var HISTORY_MAX = 50;
  var LOG_DOM_MAX = 50;
  var LS_KEY = 'jarvis-brain-stats';
  var FIREABLE = {
    FIST: 1, OPEN_PALM: 1, PINCH: 1, OK: 1, INDEX_UP: 1,
    PEACE: 1, ROCK: 1, THUMBS_UP: 1, THREE: 1, FOUR: 1
  };
  var BOOT_LINES = [
    '► Initializing neural interface...',
    '► Loading gesture classifier... OK',
    '► Calibrating hand tracker... OK',
    '► Mounting widget system... OK',
    '► JARVIS online.'
  ];
  var VALID_MODES = { idle: 1, cursor: 1, draw: 1, macro: 1, gaming: 1 };

  // ---------- State ----------
  var startedAt = Date.now();
  var state = {
    mode: 'idle',
    stats: { gestures: 0, interactions: 0, uptime: 0, startedAt: startedAt },
    history: [],
    lastGesture: 'NONE'
  };

  // Load persisted lifetime counts
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (typeof saved.gestures === 'number') state.stats.gestures = saved.gestures;
        if (typeof saved.interactions === 'number') state.stats.interactions = saved.interactions;
      }
    }
  } catch (e) { /* ignore */ }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        gestures: state.stats.gestures,
        interactions: state.stats.interactions
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- Pub/Sub ----------
  var listeners = Object.create(null);

  function on(event, handler) {
    if (typeof event !== 'string' || typeof handler !== 'function') return function () {};
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
    return function () { off(event, handler); };
  }

  function off(event, handler) {
    if (!listeners[event]) return;
    var arr = listeners[event];
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === handler) arr.splice(i, 1);
    }
  }

  function emit(event, payload) {
    if (typeof event !== 'string') return;
    pushHistory(event, payload);
    var arr = listeners[event];
    if (!arr || !arr.length) return;
    // copy to avoid mutation during emit
    var snap = arr.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i](payload); } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[Brain] listener error for ' + event, e);
      }
    }
  }

  function pushHistory(type, payload) {
    state.history.push({ ts: Date.now(), type: type, payload: payload });
    if (state.history.length > HISTORY_MAX) {
      state.history.splice(0, state.history.length - HISTORY_MAX);
    }
  }

  // ---------- DOM helpers ----------
  function $(id) {
    if (typeof document === 'undefined') return null;
    return document.getElementById(id);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function nowHMS() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  // ---------- Core methods ----------
  function say(text, opts) {
    if (text == null) return;
    var s = (typeof text === 'string') ? text : String(text);
    var ts = Date.now();
    var feed = $('log-entries');
    if (feed) {
      try {
        var item = document.createElement('div');
        item.className = 'feed-item';
        item.textContent = nowHMS() + ' — ' + s;
        // most recent on top
        if (feed.firstChild) feed.insertBefore(item, feed.firstChild);
        else feed.appendChild(item);
        // trim DOM
        while (feed.childNodes.length > LOG_DOM_MAX) {
          feed.removeChild(feed.lastChild);
        }
      } catch (e) { /* ignore DOM error */ }
    }
    emit('say', { text: s, ts: ts });
  }

  function setStatus(text) {
    var el = $('status-msg');
    if (!el) return;
    try { el.textContent = (text == null) ? '' : String(text); } catch (e) { /* ignore */ }
  }

  function setMode(name) {
    if (typeof name !== 'string') return;
    if (!VALID_MODES[name]) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[Brain] unknown mode:', name);
      return;
    }
    var from = state.mode;
    if (from === name) return;
    state.mode = name;
    var el = $('current-mode');
    if (el) {
      try { el.textContent = name.toUpperCase(); } catch (e) { /* ignore */ }
    }
    emit('mode-change', { from: from, to: name });
  }

  function getMode() { return state.mode; }

  function fireGesture(gesture) {
    if (typeof gesture !== 'string' || !gesture) return;
    if (gesture === 'NONE' || gesture === 'UNKNOWN') return;
    state.lastGesture = gesture;
    state.stats.gestures += 1;
    persist();
    var ts = Date.now();
    emit('gesture-fired', { gesture: gesture, ts: ts });
    emit('stat-update', { key: 'gestures', value: state.stats.gestures });
    if (FIREABLE[gesture]) {
      say('Gesture: ' + gesture);
    }
  }

  function bump(statKey, by) {
    if (typeof statKey !== 'string') return;
    if (!(statKey in state.stats)) return;
    var n = (typeof by === 'number' && isFinite(by)) ? by : 1;
    state.stats[statKey] = (state.stats[statKey] || 0) + n;
    if (statKey === 'gestures' || statKey === 'interactions') persist();
    emit('stat-update', { key: statKey, value: state.stats[statKey] });
  }

  function reset() {
    state.stats.gestures = 0;
    state.stats.interactions = 0;
    state.stats.uptime = 0;
    state.stats.startedAt = Date.now();
    startedAt = state.stats.startedAt;
    state.history.length = 0;
    state.lastGesture = 'NONE';
    persist();
    emit('reset', {});
    emit('stat-update', { key: 'gestures', value: 0 });
    emit('stat-update', { key: 'interactions', value: 0 });
    emit('stat-update', { key: 'uptime', value: 0 });
  }

  // ---------- Helpers ----------
  function isIdle() { return state.mode === 'idle'; }
  function isDrawing() { return state.mode === 'draw'; }
  function isCursor() { return state.mode === 'cursor'; }

  function recent(type, n) {
    var lim = (typeof n === 'number' && n > 0) ? n : 10;
    var hist = state.history;
    if (typeof type !== 'string' || !type) {
      return hist.slice(-lim).reverse();
    }
    var out = [];
    for (var i = hist.length - 1; i >= 0 && out.length < lim; i--) {
      if (hist[i].type === type) out.push(hist[i]);
    }
    return out;
  }

  // ---------- Boot sequence ----------
  function runBootSequence() {
    var bootEl = $('boot-log');
    if (!bootEl) return;
    var i = 0;
    function step() {
      if (i >= BOOT_LINES.length) return;
      try {
        var line = document.createElement('div');
        line.className = 'boot-line';
        line.textContent = BOOT_LINES[i];
        bootEl.appendChild(line);
      } catch (e) { /* ignore */ }
      i++;
      if (i < BOOT_LINES.length) setTimeout(step, 200);
    }
    step();
  }

  // ---------- Uptime ticker ----------
  function startUptimeTicker() {
    setInterval(function () {
      state.stats.uptime = Math.floor((Date.now() - startedAt) / 1000);
      emit('stat-update', { key: 'uptime', value: state.stats.uptime });
    }, 1000);
  }

  // ---------- Stable gesture loop ----------
  var gestureBuffer = [];
  var lastStable = 'NONE';
  var rafId = 0;

  function mostFrequent(arr) {
    if (!arr.length) return 'NONE';
    var counts = Object.create(null);
    var best = arr[0];
    var bestN = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] || 'NONE';
      counts[v] = (counts[v] || 0) + 1;
      if (counts[v] > bestN) { bestN = counts[v]; best = v; }
    }
    return best;
  }

  function scheduleNext() {
    rafId = requestAnimationFrame(gestureTick);
  }

  function gestureTick() {
    if (typeof document !== 'undefined' && document.hidden) {
      // pause loop while tab hidden — restarted via visibilitychange
      rafId = 0;
      return;
    }
    if (!window.GestureState) return scheduleNext();

    var g = window.GestureState.gesture;
    if (typeof g !== 'string' || !g) g = 'NONE';

    gestureBuffer.push(g);
    if (gestureBuffer.length > STABLE_BUFFER_SIZE) gestureBuffer.shift();

    if (gestureBuffer.length === STABLE_BUFFER_SIZE) {
      var stable = mostFrequent(gestureBuffer);
      if (stable !== lastStable) {
        lastStable = stable;
        if (stable !== 'NONE' && stable !== 'UNKNOWN') {
          fireGesture(stable);
        }
      }
    }
    scheduleNext();
  }

  function startGestureLoop() {
    if (rafId) return;
    scheduleNext();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !rafId) startGestureLoop();
    });
  }

  // ---------- Public API ----------
  var JarvisBrain = {
    state: state,
    on: on,
    off: off,
    emit: emit,
    say: say,
    setStatus: setStatus,
    setMode: setMode,
    getMode: getMode,
    fireGesture: fireGesture,
    bump: bump,
    reset: reset,
    isIdle: isIdle,
    isDrawing: isDrawing,
    isCursor: isCursor,
    recent: recent
  };

  // Attach immediately so other scripts polling for it find it
  if (typeof window !== 'undefined') {
    window.JarvisBrain = JarvisBrain;
  }

  // ---------- Init on DOM ready ----------
  function init() {
    runBootSequence();
    startUptimeTicker();
    startGestureLoop();
    if (typeof console !== 'undefined' && console.log) {
      console.log('🧠 JARVIS Brain online — state + event bus ready');
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      // DOM already ready — defer one tick so other scripts attach first
      setTimeout(init, 0);
    }
  }
})();
