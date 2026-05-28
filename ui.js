/* ============================================================
   JARVIS UI Controller
   Connects GestureEngine output → DOM interactions
   ============================================================ */

'use strict';

// ---- DOM refs ----
const $ = id => document.getElementById(id);

// ---- Config ----
const CFG = {
  cursorSmooth:    0.18,   // lerp factor (lower = smoother but laggier)
  pinchCooldown:  600,    // ms between click events
  scrollSpeed:    4,      // pixels per frame when scrolling
  gestureHoldMs:  120,    // ms gesture must be stable before acting
};

// ---- UI State ----
const UIState = {
  cursorX: window.innerWidth  / 2,
  cursorY: window.innerHeight / 2,
  targetX: window.innerWidth  / 2,
  targetY: window.innerHeight / 2,
  lastClickTime: 0,
  scrollOffset: 0,
  maxScroll: 0,
  mode: 'CURSOR',  // CURSOR | SCROLL
  hoveredBtn: null,
  rafId: null,
  gestureBuffer: [],      // last N gesture names for stability
  stableGesture: 'NONE',
  bootDone: false,
};

// Boot log lines
const BOOT_LINES = [
  '► Loading gesture recognition model...',
  '► Calibrating hand landmark detector...',
  '► Activating HUD interface...',
  '► Connecting to camera subsystem...',
  '► All systems nominal. Ready.',
];

// ---- BOOT SEQUENCE ----
function runBootSequence(cb) {
  const logEl = $('boot-log');
  let i = 0;
  const interval = setInterval(() => {
    if (i < BOOT_LINES.length) {
      const div = document.createElement('div');
      div.textContent = BOOT_LINES[i];
      div.style.animation = 'none';
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
      i++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        $('start-btn').style.display = 'block';
        if (cb) cb();
      }, 400);
    }
  }, 380);
}

// ---- SYSTEM START (called by button) ----
window.startSystem = function() {
  const bootScreen = $('boot-screen');
  const hud = $('hud');

  // Fade out boot screen
  bootScreen.style.transition = 'opacity 0.8s';
  bootScreen.style.opacity = '0';
  setTimeout(() => {
    bootScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    UIState.bootDone = true;
    initHUD();
  }, 800);
};

// ---- INIT HUD ----
function initHUD() {
  // Clock
  setInterval(updateClock, 1000);
  updateClock();

  // Measure scroll zone
  const scrollContent = $('scroll-content');
  const scrollZone    = $('scroll-zone');
  UIState.maxScroll = Math.max(0, scrollContent.scrollHeight - scrollZone.clientHeight);

  // Start cursor animation loop
  requestAnimationFrame(animationLoop);

  // Status dots — cam active
  $('cam-dot').classList.add('active');

  setStatus('Initializing hand tracking...');

  // Init MediaPipe
  const handsInstance = GestureEngine.initMediaPipe();
  const video = $('cam');

  GestureEngine.startCamera(video, handsInstance, () => {
    setStatus('Camera active. Show your hand to begin.');
    $('cam-dot').classList.add('active');
  });
}

// ---- CLOCK ----
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  $('hud-time').textContent = `${hh}:${mm}:${ss}`;
}

// ---- STATUS ----
function setStatus(msg, type) {
  const el = $('status-msg');
  el.textContent = msg;
  el.style.color = type === 'error' ? 'var(--red)' : 'var(--text)';
}

// ---- GESTURE STABILITY (debounce rapid flickers) ----
function getStableGesture(newGesture) {
  UIState.gestureBuffer.push(newGesture);
  if (UIState.gestureBuffer.length > 5) UIState.gestureBuffer.shift();
  // Most frequent in buffer
  const counts = {};
  UIState.gestureBuffer.forEach(g => { counts[g] = (counts[g] || 0) + 1; });
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}

// ---- CURSOR ANIMATION LOOP ----
function animationLoop() {
  const gs = window.GestureState;

  // Lerp cursor toward target
  UIState.cursorX += (UIState.targetX - UIState.cursorX) * CFG.cursorSmooth;
  UIState.cursorY += (UIState.targetY - UIState.cursorY) * CFG.cursorSmooth;

  const cursor = $('gesture-cursor');
  cursor.style.left = UIState.cursorX + 'px';
  cursor.style.top  = UIState.cursorY + 'px';

  // Scroll if PEACE gesture active
  if (UIState.stableGesture === 'PEACE') {
    doScroll();
  }

  // Hover detection on demo buttons
  detectButtonHover(UIState.cursorX, UIState.cursorY);

  // Update FPS in panel
  if (gs.fps) $('info-fps').textContent = gs.fps + ' fps';

  UIState.rafId = requestAnimationFrame(animationLoop);
}

// ---- GESTURE HANDLER (called by engine) ----
window.UI = {

  onGesture(gs) {
    if (!UIState.bootDone) return;

    const stable = getStableGesture(gs.gesture);
    UIState.stableGesture = stable;

    // Tracking dots
    $('track-dot').classList.add('active');
    $('gest-dot').classList.toggle('active', stable !== 'NONE');

    // Update info panel
    $('info-hand').textContent    = gs.handedness;
    $('info-fingers').textContent = gs.fingersUp.filter(Boolean).length + ' / 5';
    $('info-gesture').textContent = stable;
    $('info-conf').textContent    = gs.confidence + '%';

    // Gesture label
    $('gesture-name').textContent = gestureEmoji(stable) + '  ' + stable.replace(/_/g,' ');

    // Highlight gesture guide
    highlightGuide(stable);

    // Move cursor (always track index tip)
    if (gs.indexTip) {
      UIState.targetX = gs.indexTip.x;
      UIState.targetY = gs.indexTip.y;
    }

    // Gesture actions
    switch (stable) {

      case 'INDEX_UP':
        UIState.mode = 'CURSOR';
        updateMode();
        setStatus('Cursor mode — point to move');
        break;

      case 'PINCH':
        doPinch();
        break;

      case 'PEACE':
        UIState.mode = 'SCROLL';
        updateMode();
        setStatus('Scroll mode — peace sign up/down');
        break;

      case 'FIST':
        if (!gs.paused) {
          togglePause(true);
        }
        break;

      case 'OPEN_PALM':
        if (gs.paused) togglePause(false);
        UIState.mode = 'CURSOR';
        updateMode();
        setStatus('Palm reset — cursor mode active');
        break;

      case 'ROCK':
        toggleMode();
        break;

      case 'OK':
        logAction('OK — item selected ✓');
        setStatus('OK gesture — selected!');
        break;

      case 'THUMBS_UP':
        logAction('Thumbs up received 👍');
        setStatus('Thumbs up!');
        break;
    }
  },

  onNoHand() {
    if (!UIState.bootDone) return;
    $('track-dot').classList.remove('active');
    $('gest-dot').classList.remove('active');
    $('info-hand').textContent    = '–';
    $('info-fingers').textContent = '–';
    $('info-gesture').textContent = 'No hand';
    $('info-conf').textContent    = '–';
    $('gesture-name').textContent = '–';
    UIState.stableGesture = 'NONE';
    highlightGuide('NONE');
    setStatus('No hand detected — show your hand to the camera');
  },

  setStatus,
};

// ---- PINCH CLICK ----
function doPinch() {
  const now = Date.now();
  if (now - UIState.lastClickTime < CFG.pinchCooldown) return;
  UIState.lastClickTime = now;

  // Visual feedback
  const cursor = $('gesture-cursor');
  cursor.classList.add('pinching');
  setTimeout(() => cursor.classList.remove('pinching'), 300);

  // Ripple
  showRipple(UIState.cursorX, UIState.cursorY);

  // Hit test demo buttons
  const btn = getHoveredButton(UIState.cursorX, UIState.cursorY);
  if (btn) {
    clickButton(btn);
  } else {
    setStatus('Pinch click at (' + Math.round(UIState.cursorX) + ', ' + Math.round(UIState.cursorY) + ')');
    logAction('Click at (' + Math.round(UIState.cursorX) + ', ' + Math.round(UIState.cursorY) + ')');
  }
}

// ---- RIPPLE EFFECT ----
function showRipple(x, y) {
  const r = $('click-ripple');
  r.style.left = x + 'px';
  r.style.top  = y + 'px';
  r.classList.remove('hidden');
  r.style.animation = 'none';
  void r.offsetWidth; // reflow
  r.style.animation = 'ripple-anim 0.5s ease-out forwards';
  setTimeout(() => r.classList.add('hidden'), 550);
}

// ---- SCROLL ----
function doScroll() {
  const content = $('scroll-content');
  UIState.scrollOffset = Math.min(UIState.scrollOffset + CFG.scrollSpeed, UIState.maxScroll);
  content.style.transform = `translateY(-${UIState.scrollOffset}px)`;

  // Auto-reset at bottom
  if (UIState.scrollOffset >= UIState.maxScroll) {
    setTimeout(() => {
      UIState.scrollOffset = 0;
    }, 1000);
  }
}

// ---- BUTTON HOVER DETECTION ----
const demoButtons = () => Array.from(document.querySelectorAll('.demo-btn'));

function getButtonRect(btn) {
  return btn.getBoundingClientRect();
}

function getHoveredButton(cx, cy) {
  for (const btn of demoButtons()) {
    const r = getButtonRect(btn);
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
      return btn;
    }
  }
  return null;
}

function detectButtonHover(cx, cy) {
  const hovered = getHoveredButton(cx, cy);
  if (hovered !== UIState.hoveredBtn) {
    if (UIState.hoveredBtn) UIState.hoveredBtn.classList.remove('hovered');
    UIState.hoveredBtn = hovered;
    if (hovered) {
      hovered.classList.add('hovered');
      setStatus('Hover: ' + hovered.textContent.trim() + ' — pinch to activate');
    }
  }
}

// ---- BUTTON CLICK ----
function clickButton(btn) {
  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 600);
  logAction('Activated: ' + btn.textContent.trim());
  setStatus('Activated: ' + btn.textContent.trim() + ' ✓');
}

// ---- PAUSE ----
function togglePause(state) {
  window.GestureState.paused = state;
  $('paused-badge').classList.toggle('hidden', !state);
  $('gest-dot').classList.toggle('warn', state);
  if (state) {
    setStatus('⏸ PAUSED — open palm to resume');
    logAction('System paused (fist gesture)');
  } else {
    setStatus('▶ Resumed — gesture control active');
    logAction('System resumed');
  }
}

// ---- MODE TOGGLE ----
function toggleMode() {
  UIState.mode = UIState.mode === 'CURSOR' ? 'SCROLL' : 'CURSOR';
  updateMode();
  logAction('Mode switched to ' + UIState.mode);
  setStatus('Mode: ' + UIState.mode);
}

function updateMode() {
  $('current-mode').textContent = UIState.mode;
}

// ---- LOG ----
let logCount = 0;
function logAction(msg) {
  const container = $('log-entries');
  const div = document.createElement('div');
  div.textContent = '► ' + msg;
  div.style.opacity = '0';
  div.style.transition = 'opacity 0.3s';
  container.insertBefore(div, container.firstChild);
  setTimeout(() => div.style.opacity = '1', 10);
  // Keep only last 3
  while (container.children.length > 3) {
    container.removeChild(container.lastChild);
  }
}

// ---- GESTURE GUIDE HIGHLIGHT ----
const GUIDE_MAP = {
  INDEX_UP:  'gi-cursor',
  PINCH:     'gi-click',
  PEACE:     'gi-scroll',
  FIST:      'gi-fist',
  OPEN_PALM: 'gi-open',
  OK:        'gi-ok',
  ROCK:      'gi-rock',
  POINT_SIDE:'gi-point',
};

function highlightGuide(gesture) {
  Object.values(GUIDE_MAP).forEach(id => $$(id));
  const id = GUIDE_MAP[gesture];
  if (id) $(id).classList.add('active');
}

function $$(id) {
  const el = $(id);
  if (el) el.classList.remove('active');
}

// ---- EMOJI ----
function gestureEmoji(g) {
  const map = {
    INDEX_UP:  '☝️', PINCH: '🤏', PEACE: '✌️', FIST: '✊',
    OPEN_PALM: '🖐️', OK: '👌', ROCK: '🤘', THUMBS_UP: '👍',
    POINT_SIDE:'👉', THREE: '🤟', FOUR: '🖖', NONE: '–', UNKNOWN: '❓',
  };
  return map[g] || '•';
}

// ---- BOOT ON LOAD ----
window.addEventListener('load', () => {
  // Hide start btn until boot sequence done
  $('start-btn').style.display = 'none';
  runBootSequence();
});
