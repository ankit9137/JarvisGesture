'use strict';
/* JARVIS Gesture Trainer — interactive on-screen tutor.
   Adds a floating, draggable panel showing every gesture with:
   - emoji visual
   - per-finger up/down diagram (5 dots: thumb / index / middle / ring / pinky)
   - what it triggers
   - a LIVE indicator that lights green when you're currently making it
   The trainer auto-detects the active gesture from window.GestureState every frame. */
(function () {
  var LS_KEY = 'gesture-trainer';
  var GESTURES = [
    { name: 'OPEN_PALM', emoji: '🖐', fingers: [1, 1, 1, 1, 1], desc: 'All fingers spread wide, palm facing camera', action: 'Easiest to detect — start here' },
    { name: 'FIST',      emoji: '✊', fingers: [0, 0, 0, 0, 0], desc: 'Close your hand into a fist',                   action: 'Clears the air-draw canvas' },
    { name: 'THUMBS_UP', emoji: '👍', fingers: [1, 0, 0, 0, 0], desc: 'Fist, then stick ONLY thumb straight up',       action: 'Toggles air-draw mode' },
    { name: 'INDEX_UP',  emoji: '☝', fingers: [0, 1, 0, 0, 0], desc: 'Fist, then point ONLY index finger up',          action: 'Draws when air-draw is on' },
    { name: 'PEACE',     emoji: '✌', fingers: [0, 1, 1, 0, 0], desc: 'Index + middle up (victory sign)',               action: 'Part of screenshot macro (then OK)' },
    { name: 'THREE',     emoji: '🤟', fingers: [0, 1, 1, 1, 0], desc: 'Index + middle + ring up, thumb tucked',        action: 'Counter — logged + ticker' },
    { name: 'FOUR',      emoji: '🖖', fingers: [0, 1, 1, 1, 1], desc: 'Four fingers up, thumb folded into palm',       action: 'Counter — logged + ticker' },
    { name: 'ROCK',      emoji: '🤘', fingers: [0, 1, 0, 0, 1], desc: 'Index + pinky up (devil horns)',                action: 'Counter — logged + ticker' },
    { name: 'PINCH',     emoji: '🤏', fingers: [1, 1, 0, 0, 0], desc: 'Touch thumb + index tips, other 3 curled DOWN', action: 'Click action' },
    { name: 'OK',        emoji: '👌', fingers: [1, 1, 1, 1, 1], desc: 'Touch thumb + index tips, other 3 stretched UP',action: 'Part of screenshot macro (after PEACE)' }
  ];
  // PINCH and OK both have thumb+index "extended" in the boolean check but the
  // classifier uses spatial distance. We mark them specially in the UI.
  var SPECIAL = { PINCH: 'pinch', OK: 'ok' };

  var panel = null;
  var liveLabel = null;
  var liveDot = null;
  var liveConf = null;
  var liveHand = null;
  var cards = {}; // name -> { el, dots: [5] }
  var rafId = 0;
  var dragging = false;
  var lastGesture = '';

  // ---------- DOM helpers ----------
  function ce(tag, cls, txt) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt != null) el.textContent = String(txt);
    return el;
  }

  function injectStyles() {
    if (document.getElementById('gt-styles')) return;
    var css = ''
      + '#gt-panel{position:fixed;top:60px;left:50%;transform:translateX(-50%);width:680px;max-width:96vw;max-height:80vh;'
      + 'background:rgba(0,20,35,0.95);border:1px solid rgba(0,212,255,0.6);box-shadow:0 0 24px rgba(0,212,255,0.5),0 0 60px rgba(0,212,255,0.15) inset;'
      + 'color:#00d4ff;font-family:"Courier New",monospace;font-size:11px;z-index:9999;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
      + 'border-radius:2px;overflow:hidden;display:flex;flex-direction:column;}'
      + '#gt-panel.gt-hidden{display:none;}'
      + '#gt-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(90deg,rgba(0,212,255,0.3),rgba(0,212,255,0.05));border-bottom:1px solid rgba(0,212,255,0.5);cursor:grab;user-select:none;letter-spacing:2px;}'
      + '#gt-head:active{cursor:grabbing;}'
      + '#gt-title{font-weight:bold;font-size:12px;text-shadow:0 0 6px rgba(0,212,255,0.7);}'
      + '#gt-close{background:transparent;border:1px solid rgba(0,212,255,0.6);color:#00d4ff;width:22px;height:22px;cursor:pointer;font-family:inherit;font-size:12px;line-height:1;padding:0;}'
      + '#gt-close:hover{background:rgba(255,80,80,0.4);border-color:#ff5050;color:#fff;}'
      + '#gt-live{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.35);border-bottom:1px solid rgba(0,212,255,0.3);font-size:11px;}'
      + '#gt-live-left{display:flex;align-items:center;gap:10px;}'
      + '#gt-live-dot{width:10px;height:10px;border-radius:50%;background:#444;box-shadow:0 0 6px transparent;transition:all .2s;}'
      + '#gt-live-dot.on{background:#00ff88;box-shadow:0 0 12px #00ff88;}'
      + '#gt-live-label{color:#00ff88;text-shadow:0 0 4px #00ff88;font-weight:bold;letter-spacing:1.5px;}'
      + '#gt-live-meta{color:#00d4ff;opacity:.85;}'
      + '#gt-body{padding:10px;overflow-y:auto;flex:1;}'
      + '#gt-body::-webkit-scrollbar{width:6px;}'
      + '#gt-body::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.6);}'
      + '#gt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:8px;}'
      + '.gt-card{border:1px solid rgba(0,212,255,0.35);background:rgba(0,212,255,0.03);padding:8px;transition:all .25s;position:relative;}'
      + '.gt-card.active{border-color:#00ff88;background:rgba(0,255,136,0.12);box-shadow:0 0 12px rgba(0,255,136,0.5),inset 0 0 8px rgba(0,255,136,0.2);}'
      + '.gt-card-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}'
      + '.gt-emoji{font-size:24px;line-height:1;}'
      + '.gt-name{font-weight:bold;color:#00ff88;text-shadow:0 0 4px #00ff88;letter-spacing:1px;font-size:11px;}'
      + '.gt-card.active .gt-name{color:#fff;text-shadow:0 0 8px #00ff88;}'
      + '.gt-fingers{display:flex;gap:5px;margin:4px 0 6px;}'
      + '.gt-finger{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px;}'
      + '.gt-finger-dot{width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(0,212,255,0.5);background:rgba(0,212,255,0.08);}'
      + '.gt-finger-dot.up{background:#00d4ff;box-shadow:0 0 6px #00d4ff;}'
      + '.gt-finger-dot.down{background:transparent;border-color:rgba(0,212,255,0.25);}'
      + '.gt-finger-lbl{font-size:8px;color:rgba(0,212,255,0.65);letter-spacing:1px;}'
      + '.gt-desc{font-size:10px;color:rgba(0,212,255,0.85);margin-bottom:3px;line-height:1.35;}'
      + '.gt-act{font-size:9px;color:#00ff88;opacity:.75;border-top:1px dashed rgba(0,212,255,0.2);padding-top:3px;margin-top:3px;letter-spacing:0.5px;}'
      + '.gt-card.special::after{content:"SPATIAL";position:absolute;top:4px;right:4px;font-size:7px;color:#ff9d00;border:1px solid #ff9d00;padding:1px 3px;letter-spacing:1px;}'
      + '#gt-footer{padding:6px 12px;border-top:1px solid rgba(0,212,255,0.3);font-size:9px;color:rgba(0,212,255,0.7);text-align:center;letter-spacing:1px;}'
      + '#gt-toggle{position:fixed;top:60px;right:12px;z-index:9998;background:rgba(0,20,35,0.85);border:1px solid rgba(0,212,255,0.6);color:#00d4ff;font-family:"Courier New",monospace;font-size:11px;padding:6px 10px;cursor:pointer;letter-spacing:1.5px;box-shadow:0 0 8px rgba(0,212,255,0.4);}'
      + '#gt-toggle:hover{background:rgba(0,212,255,0.3);color:#fff;box-shadow:0 0 12px #00d4ff;}'
      + '@keyframes gt-pop{0%{transform:scale(1);}50%{transform:scale(1.08);}100%{transform:scale(1);}}'
      + '.gt-card.pop{animation:gt-pop .3s ease;}';
    var s = document.createElement('style');
    s.id = 'gt-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- Card builder ----------
  function buildCard(g) {
    var c = ce('div', 'gt-card' + (SPECIAL[g.name] ? ' special' : ''));
    c.setAttribute('data-gesture', g.name);

    var top = ce('div', 'gt-card-top');
    top.appendChild(ce('span', 'gt-emoji', g.emoji));
    top.appendChild(ce('span', 'gt-name', g.name));
    c.appendChild(top);

    var fingers = ce('div', 'gt-fingers');
    var labels = ['T', 'I', 'M', 'R', 'P'];
    var dots = [];
    for (var i = 0; i < 5; i++) {
      var col = ce('div', 'gt-finger');
      var dot = ce('div', 'gt-finger-dot ' + (g.fingers[i] ? 'up' : 'down'));
      var lbl = ce('div', 'gt-finger-lbl', labels[i]);
      col.appendChild(dot);
      col.appendChild(lbl);
      fingers.appendChild(col);
      dots.push(dot);
    }
    c.appendChild(fingers);

    c.appendChild(ce('div', 'gt-desc', g.desc));
    c.appendChild(ce('div', 'gt-act', '→ ' + g.action));

    cards[g.name] = { el: c, dots: dots };
    return c;
  }

  // ---------- Panel construction ----------
  function buildPanel() {
    panel = ce('div'); panel.id = 'gt-panel';

    var head = ce('div'); head.id = 'gt-head';
    head.appendChild(ce('span', null, 'JARVIS GESTURE TRAINER'));
    var headRight = ce('div');
    var closeBtn = ce('button', null, '×'); closeBtn.id = 'gt-close';
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); hidePanel(); });
    headRight.appendChild(closeBtn);
    head.appendChild(headRight);
    panel.appendChild(head);

    var live = ce('div'); live.id = 'gt-live';
    var leftWrap = ce('div'); leftWrap.id = 'gt-live-left';
    liveDot = ce('div'); liveDot.id = 'gt-live-dot';
    liveLabel = ce('span', null, 'WAITING FOR HAND...'); liveLabel.id = 'gt-live-label';
    leftWrap.appendChild(liveDot);
    leftWrap.appendChild(liveLabel);
    live.appendChild(leftWrap);
    var meta = ce('div'); meta.id = 'gt-live-meta';
    liveHand = ce('span', null, 'HAND: –');
    liveConf = ce('span', null, '  CONF: 0%');
    meta.appendChild(liveHand);
    meta.appendChild(liveConf);
    live.appendChild(meta);
    panel.appendChild(live);

    var body = ce('div'); body.id = 'gt-body';
    var grid = ce('div'); grid.id = 'gt-grid';
    for (var i = 0; i < GESTURES.length; i++) {
      grid.appendChild(buildCard(GESTURES[i]));
    }
    body.appendChild(grid);
    panel.appendChild(body);

    var foot = ce('div'); foot.id = 'gt-footer';
    foot.textContent = 'T=THUMB  I=INDEX  M=MIDDLE  R=RING  P=PINKY   •   FILLED=UP   EMPTY=DOWN   •   DRAG HEADER TO MOVE';
    panel.appendChild(foot);

    attachDrag(panel, head);
    document.body.appendChild(panel);
  }

  // ---------- Toggle button ----------
  function buildToggle() {
    var b = ce('button', null, '🤚 GESTURE GUIDE');
    b.id = 'gt-toggle';
    b.type = 'button';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(b);
  }

  // ---------- Drag ----------
  function attachDrag(el, handle) {
    var sx = 0, sy = 0, ox = 0, oy = 0;
    function onDown(ev) {
      if (ev.target && ev.target.id === 'gt-close') return;
      dragging = true;
      var r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.transform = '';
      ox = r.left; oy = r.top;
      sx = ev.clientX; sy = ev.clientY;
      ev.preventDefault();
    }
    function onMove(ev) {
      if (!dragging) return;
      var nx = ox + (ev.clientX - sx);
      var ny = oy + (ev.clientY - sy);
      var maxX = window.innerWidth - el.offsetWidth;
      var maxY = window.innerHeight - el.offsetHeight;
      if (nx < 0) nx = 0; else if (nx > maxX) nx = maxX;
      if (ny < 0) ny = 0; else if (ny > maxY) ny = maxY;
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(LS_KEY + '-pos', JSON.stringify({ left: el.style.left, top: el.style.top }));
      } catch (e) {}
    }
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function restorePos() {
    if (!panel) return;
    try {
      var raw = localStorage.getItem(LS_KEY + '-pos');
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && p.left && p.top) {
        panel.style.left = p.left;
        panel.style.top = p.top;
        panel.style.transform = '';
      }
    } catch (e) {}
  }

  // ---------- Show / hide ----------
  function hidePanel() {
    if (panel) panel.classList.add('gt-hidden');
    try { localStorage.setItem(LS_KEY + '-hidden', 'true'); } catch (e) {}
  }
  function showPanel() {
    if (panel) panel.classList.remove('gt-hidden');
    try { localStorage.removeItem(LS_KEY + '-hidden'); } catch (e) {}
  }
  function togglePanel() {
    if (!panel) return;
    if (panel.classList.contains('gt-hidden')) showPanel(); else hidePanel();
  }

  // ---------- Live update loop ----------
  function updateLive() {
    var gs = window.GestureState;
    if (!gs) { rafId = requestAnimationFrame(updateLive); return; }

    var g = gs.gesture || 'NONE';
    var conf = (typeof gs.confidence === 'number') ? gs.confidence : 0;
    var hand = gs.handedness || '–';

    // Update live readout
    if (liveLabel) {
      if (g === 'NONE') {
        liveLabel.textContent = 'WAITING FOR HAND...';
        liveLabel.style.color = '#666';
      } else if (g === 'UNKNOWN') {
        liveLabel.textContent = 'UNKNOWN POSE — TRY A LISTED GESTURE';
        liveLabel.style.color = '#ff9d00';
      } else {
        liveLabel.textContent = g;
        liveLabel.style.color = '#00ff88';
      }
    }
    if (liveDot) {
      if (g !== 'NONE' && g !== 'UNKNOWN') liveDot.classList.add('on');
      else liveDot.classList.remove('on');
    }
    if (liveHand) liveHand.textContent = 'HAND: ' + hand;
    if (liveConf) liveConf.textContent = '  CONF: ' + conf + '%';

    // Highlight active card
    if (g !== lastGesture) {
      // clear previous
      if (lastGesture && cards[lastGesture]) {
        cards[lastGesture].el.classList.remove('active');
      }
      // set new
      if (cards[g]) {
        cards[g].el.classList.add('active', 'pop');
        var c = cards[g].el;
        setTimeout(function () { if (c) c.classList.remove('pop'); }, 320);
      }
      lastGesture = g;
    }

    rafId = requestAnimationFrame(updateLive);
  }

  function startLoop() {
    if (rafId) return;
    rafId = requestAnimationFrame(updateLive);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !rafId) startLoop();
      else if (document.hidden && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    });
  }

  // ---------- Init ----------
  function init() {
    injectStyles();
    buildPanel();
    buildToggle();
    restorePos();
    try {
      if (localStorage.getItem(LS_KEY + '-hidden') === 'true') hidePanel();
    } catch (e) {}
    startLoop();
    if (typeof console !== 'undefined' && console.log) {
      console.log('🤚 JARVIS Gesture Trainer ready — click "GESTURE GUIDE" top-right to toggle');
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      setTimeout(init, 0);
    }
  }

  // Public API
  window.GestureTrainer = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel
  };
})();
