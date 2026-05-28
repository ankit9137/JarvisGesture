/* ============================================================
   JARVIS Gesture Engine v2
   - Dual-hand support (maxNumHands: 2)
   - Smarter finger classifier (palm orientation aware)
   - Exposes window.GestureState (primary hand) AND
            window.GestureState2 (second hand if present)
            window.GestureHands  (array of both hands)
   - Velocity tracking per landmark for lightning-fx.js
   ============================================================ */

'use strict';

// ---------- LANDMARK INDICES (MediaPipe standard) ----------
const LM = {
  WRIST:      0,
  THUMB_CMC:  1, THUMB_MCP:  2, THUMB_IP:   3, THUMB_TIP:  4,
  INDEX_MCP:  5, INDEX_PIP:  6, INDEX_DIP:  7, INDEX_TIP:  8,
  MIDDLE_MCP: 9, MIDDLE_PIP:10, MIDDLE_DIP:11, MIDDLE_TIP:12,
  RING_MCP:  13, RING_PIP:  14, RING_DIP:  15, RING_TIP:  16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// ---------- GESTURE STATE (primary / right hand by default) ----------
window.GestureState = {
  gesture: 'NONE',
  prevGesture: 'NONE',
  handedness: '–',
  fingersUp: [],
  indexTip: { x: 0, y: 0 },
  confidence: 0,
  paused: false,
  lastGestureTime: 0,
  fps: 0,
  _frameCount: 0,
  _lastFpsTime: Date.now(),
};

// Secondary hand (when a 2nd hand is present)
window.GestureState2 = {
  gesture: 'NONE',
  handedness: '–',
  fingersUp: [],
  indexTip: { x: 0, y: 0 },
  confidence: 0,
  present: false,
};

// Full array of detected hands — each entry has {landmarks(mirrored screen px), gesture, handedness, confidence, fingersUp, velocity}
// Read this from lightning-fx.js
window.GestureHands = [];

// ---------- HELPERS ----------
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Returns array of 5 booleans: [thumb, index, middle, ring, pinky]
 * Uses palm-normal heuristics — works regardless of hand orientation.
 */
function getFingersUp(lm, handedness) {
  // Palm center ~ middle of (WRIST + MIDDLE_MCP)
  const palmX = (lm[LM.WRIST].x + lm[LM.MIDDLE_MCP].x) / 2;
  const palmY = (lm[LM.WRIST].y + lm[LM.MIDDLE_MCP].y) / 2;

  // Reference "up" direction: from wrist to middle-mcp
  const upX = lm[LM.MIDDLE_MCP].x - lm[LM.WRIST].x;
  const upY = lm[LM.MIDDLE_MCP].y - lm[LM.WRIST].y;
  const upLen = Math.sqrt(upX * upX + upY * upY) || 1;
  const upNX = upX / upLen, upNY = upY / upLen;

  // Generic finger-extended check: project (tip - mcp) onto palm-up axis.
  // If projection > threshold * handSize, finger is extended.
  const handSize = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 0.001;

  function extended(tipI, mcpI, threshold) {
    const dx = lm[tipI].x - lm[mcpI].x;
    const dy = lm[tipI].y - lm[mcpI].y;
    const proj = dx * upNX + dy * upNY; // signed projection along palm-up
    return proj > handSize * (threshold || 0.55);
  }

  // Thumb: special — extension is sideways relative to palm.
  // Check thumb tip distance from index mcp; if large, thumb is out.
  const thumbOutDist = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_MCP]);
  const thumbOut = thumbOutDist > handSize * 0.85;

  return [
    thumbOut,
    extended(LM.INDEX_TIP,  LM.INDEX_MCP,  0.6),
    extended(LM.MIDDLE_TIP, LM.MIDDLE_MCP, 0.6),
    extended(LM.RING_TIP,   LM.RING_MCP,   0.55),
    extended(LM.PINKY_TIP,  LM.PINKY_MCP,  0.5),
  ];
}

/**
 * Main gesture classifier — orientation independent.
 */
function classifyGesture(lm, handedness) {
  const f = getFingersUp(lm, handedness);
  const [thumb, index, middle, ring, pinky] = f;
  const extCount = f.filter(Boolean).length;

  const pinchDist = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]);
  const handSize  = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 0.001;

  // PINCH / OK: thumb+index tips touching
  if (pinchDist < handSize * 0.30) {
    if (!middle && !ring && !pinky) return 'PINCH';
    if (middle && ring && pinky)    return 'OK';
  }

  if (extCount === 0)                                       return 'FIST';
  if (extCount >= 4 && index && middle && ring && pinky)    return 'OPEN_PALM';

  if (!index && !middle && !ring && !pinky && thumb)        return 'THUMBS_UP';
  if (index && !middle && !ring && !pinky)                  return 'INDEX_UP';
  if (index && middle && !ring && !pinky)                   return 'PEACE';
  if (index && !middle && !ring && pinky)                   return 'ROCK';
  if (index && middle && ring && !pinky)                    return 'THREE';
  if (index && middle && ring && pinky && !thumb)           return 'FOUR';

  return 'UNKNOWN';
}

// ---------- FPS TRACKER ----------
function updateFps() {
  const gs = window.GestureState;
  gs._frameCount++;
  const now = Date.now();
  const elapsed = (now - gs._lastFpsTime) / 1000;
  if (elapsed >= 1) {
    gs.fps = Math.round(gs._frameCount / elapsed);
    gs._frameCount = 0;
    gs._lastFpsTime = now;
  }
}

// ---------- VELOCITY TRACKING (per-hand, per-keypoint) ----------
const VEL_KEYS = [LM.INDEX_TIP, LM.THUMB_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP, LM.WRIST];
const velCache = []; // [{prev:{i:{x,y}}, ts}] indexed by hand index

function computeVelocity(handIdx, screenLms) {
  const now = Date.now();
  const v = { speed: 0, dx: 0, dy: 0 };
  if (!velCache[handIdx]) {
    velCache[handIdx] = { prev: {}, ts: now };
  }
  const cache = velCache[handIdx];
  const dt = Math.max(1, now - cache.ts);
  let sumSpd = 0, cnt = 0;
  for (const k of VEL_KEYS) {
    const cur = screenLms[k];
    if (!cur) continue;
    const prev = cache.prev[k];
    if (prev) {
      const ddx = cur.x - prev.x;
      const ddy = cur.y - prev.y;
      const s = Math.sqrt(ddx * ddx + ddy * ddy) / dt * 1000; // px/sec
      sumSpd += s;
      cnt++;
      if (k === LM.WRIST) { v.dx = ddx; v.dy = ddy; }
    }
    cache.prev[k] = { x: cur.x, y: cur.y };
  }
  cache.ts = now;
  v.speed = cnt > 0 ? sumSpd / cnt : 0;
  return v;
}

// ---------- MEDIAPIPE SETUP ----------
let handsModel = null;
let cameraUtil = null;

function initMediaPipe() {
  handsModel = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  handsModel.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.50,
    selfieMode: true,  // tell MediaPipe the input is selfie/mirrored
  });

  handsModel.onResults(onHandResults);
  return handsModel;
}

// ---------- RESULTS HANDLER ----------
function onHandResults(results) {
  if (window.GestureState.paused) return;

  updateFps();

  const canvas  = document.getElementById('output-canvas');
  const ctx     = canvas.getContext('2d');
  const video   = document.getElementById('cam');

  canvas.width  = video.videoWidth  || window.innerWidth;
  canvas.height = video.videoHeight || window.innerHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  const gs = window.GestureState;
  gs.prevGesture = gs.gesture;

  // Reset hands array
  window.GestureHands = [];

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    for (let h = 0; h < results.multiHandLandmarks.length; h++) {
      const landmarks  = results.multiHandLandmarks[h];
      const handedness = results.multiHandedness[h].label;
      const conf       = results.multiHandedness[h].score;

      drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      drawConnections(ctx, landmarks, canvas.width, canvas.height);

      const gesture = classifyGesture(landmarks, handedness);
      const fingers = getFingersUp(landmarks, handedness);

      // Mirrored screen-space landmarks for FX layer
      const screenLms = landmarks.map(p => ({
        x: (1 - p.x) * window.innerWidth,
        y: p.y * window.innerHeight,
      }));
      const velocity = computeVelocity(h, screenLms);

      const handObj = {
        index: h,
        handedness: handedness,
        gesture: gesture,
        confidence: Math.round(conf * 100),
        fingersUp: fingers,
        landmarks: screenLms,
        velocity: velocity,
        indexTip: screenLms[LM.INDEX_TIP],
        palmCenter: {
          x: (screenLms[LM.WRIST].x + screenLms[LM.MIDDLE_MCP].x) / 2,
          y: (screenLms[LM.WRIST].y + screenLms[LM.MIDDLE_MCP].y) / 2,
        },
      };
      window.GestureHands.push(handObj);

      // Primary hand = first detected
      if (h === 0) {
        gs.gesture        = gesture;
        gs.handedness     = handedness;
        gs.fingersUp      = fingers;
        gs.confidence     = Math.round(conf * 100);
        gs.indexTip       = screenLms[LM.INDEX_TIP];
        gs.lastGestureTime = Date.now();
        if (window.UI) window.UI.onGesture(gs);
      }
      // Secondary hand
      if (h === 1) {
        const gs2 = window.GestureState2;
        gs2.gesture    = gesture;
        gs2.handedness = handedness;
        gs2.fingersUp  = fingers;
        gs2.confidence = Math.round(conf * 100);
        gs2.indexTip   = screenLms[LM.INDEX_TIP];
        gs2.present    = true;
      }
    }
    // If only 1 hand, clear the secondary
    if (results.multiHandLandmarks.length < 2) {
      window.GestureState2.present = false;
      window.GestureState2.gesture = 'NONE';
    }

  } else {
    gs.gesture    = 'NONE';
    gs.handedness = '–';
    gs.confidence = 0;
    window.GestureState2.present = false;
    window.GestureState2.gesture = 'NONE';
    if (window.UI) window.UI.onNoHand();
  }
}

// ---------- DRAW HELPERS ----------
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

function drawLandmarks(ctx, lm, w, h) {
  lm.forEach((pt, i) => {
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === LM.INDEX_TIP ? '#00ff88' : 'rgba(0,212,255,0.85)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 9 : 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,212,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawConnections(ctx, lm, w, h) {
  ctx.strokeStyle = 'rgba(0,212,255,0.5)';
  ctx.lineWidth = 2;
  CONNECTIONS.forEach(([a, b]) => {
    const ax = (1 - lm[a].x) * w, ay = lm[a].y * h;
    const bx = (1 - lm[b].x) * w, by = lm[b].y * h;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  });
}

// ---------- CAMERA START ----------
function startCamera(videoEl, handsInstance, onReady) {
  cameraUtil = new Camera(videoEl, {
    onFrame: async () => {
      await handsInstance.send({ image: videoEl });
    },
    width: 1280,
    height: 720,
  });
  cameraUtil.start().then(() => {
    if (onReady) onReady();
  }).catch(err => {
    console.error('Camera error:', err);
    if (window.UI) window.UI.setStatus('Camera access denied — please allow camera permission and reload.', 'error');
  });
}

window.GestureEngine = { initMediaPipe, startCamera, LM: LM };
