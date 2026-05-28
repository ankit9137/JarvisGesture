/* ============================================================
   JARVIS Gesture Engine
   Uses MediaPipe Hands to detect hand landmarks and classify
   gestures in real-time.
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

// ---------- GESTURE STATE ----------
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

// ---------- HELPERS ----------

/** Euclidean distance between two landmarks */
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Returns array of 5 booleans: [thumb, index, middle, ring, pinky]
 * true = finger is extended (up)
 */
function getFingersUp(lm, handedness) {
  const fingers = [];

  // Thumb: compare tip x vs IP x (mirror for Right/Left hand)
  const thumbExtended = handedness === 'Right'
    ? lm[LM.THUMB_TIP].x < lm[LM.THUMB_IP].x
    : lm[LM.THUMB_TIP].x > lm[LM.THUMB_IP].x;
  fingers.push(thumbExtended);

  // Index – Pinky: tip y < pip y means extended
  const fingerPairs = [
    [LM.INDEX_TIP,  LM.INDEX_PIP],
    [LM.MIDDLE_TIP, LM.MIDDLE_PIP],
    [LM.RING_TIP,   LM.RING_PIP],
    [LM.PINKY_TIP,  LM.PINKY_PIP],
  ];
  for (const [tip, pip] of fingerPairs) {
    fingers.push(lm[tip].y < lm[pip].y);
  }

  return fingers; // [thumb, index, middle, ring, pinky]
}

/**
 * Main gesture classifier.
 * Returns gesture name string.
 */
function classifyGesture(lm, handedness) {
  const f = getFingersUp(lm, handedness);
  const [thumb, index, middle, ring, pinky] = f;
  const extCount = f.filter(Boolean).length;

  // ---- FIST: all fingers closed ----
  if (extCount === 0) return 'FIST';

  // ---- OPEN PALM: all fingers extended ----
  if (extCount === 5) return 'OPEN_PALM';

  // ---- PINCH: thumb + index close, others down ----
  const pinchDist = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]);
  const handSize  = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
  if (pinchDist < handSize * 0.22 && !middle && !ring && !pinky) return 'PINCH';

  // ---- OK SIGN: thumb + index circle, others up ----
  if (pinchDist < handSize * 0.22 && middle && ring && pinky) return 'OK';

  // ---- INDEX ONLY (cursor) ----
  if (!thumb && index && !middle && !ring && !pinky) return 'INDEX_UP';

  // ---- PEACE / SCROLL: index + middle up ----
  if (!thumb && index && middle && !ring && !pinky) return 'PEACE';

  // ---- POINT RIGHT: index pointing to side ----
  // Index tip x significantly different from MCP x (pointing horizontally)
  if (!thumb && index && !middle && !ring && !pinky) {
    const dx = lm[LM.INDEX_TIP].x - lm[LM.INDEX_MCP].x;
    if (Math.abs(dx) > 0.1) return 'POINT_SIDE';
  }

  // ---- ROCK ON: index + pinky up, others down ----
  if (!thumb && index && !middle && !ring && pinky) return 'ROCK';

  // ---- THUMBS UP ----
  if (thumb && !index && !middle && !ring && !pinky) return 'THUMBS_UP';

  // ---- THREE FINGERS ----
  if (!thumb && index && middle && ring && !pinky) return 'THREE';

  // ---- FOUR FINGERS ----
  if (!thumb && index && middle && ring && pinky) return 'FOUR';

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

// ---------- MEDIAPIPE SETUP ----------
let handsModel = null;
let cameraUtil = null;

function initMediaPipe() {
  handsModel = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  handsModel.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.60,
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

  // Resize canvas to match video
  canvas.width  = video.videoWidth  || window.innerWidth;
  canvas.height = video.videoHeight || window.innerHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw video frame
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  const gs = window.GestureState;
  gs.prevGesture = gs.gesture;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks   = results.multiHandLandmarks[0];
    const handedness  = results.multiHandedness[0].label; // 'Right' or 'Left'
    const confidence  = results.multiHandedness[0].score;

    // Draw landmarks
    drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
    drawConnections(ctx, landmarks, canvas.width, canvas.height);

    // Classify
    const gesture = classifyGesture(landmarks, handedness);
    const fingers = getFingersUp(landmarks, handedness);

    // Update state
    gs.gesture     = gesture;
    gs.handedness  = handedness;
    gs.fingersUp   = fingers;
    gs.confidence  = Math.round(confidence * 100);
    gs.indexTip    = {
      x: (1 - landmarks[LM.INDEX_TIP].x) * window.innerWidth,  // mirrored
      y: landmarks[LM.INDEX_TIP].y * window.innerHeight,
    };
    gs.lastGestureTime = Date.now();

    // Fire UI update
    if (window.UI) window.UI.onGesture(gs);

  } else {
    // No hand detected
    gs.gesture    = 'NONE';
    gs.handedness = '–';
    gs.confidence = 0;
    if (window.UI) window.UI.onNoHand();
  }
}

// ---------- DRAW HELPERS ----------
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],        // thumb
  [0,5],[5,6],[6,7],[7,8],        // index
  [0,9],[9,10],[10,11],[11,12],   // middle
  [0,13],[13,14],[14,15],[15,16], // ring
  [0,17],[17,18],[18,19],[19,20], // pinky
  [5,9],[9,13],[13,17],           // palm
];

function drawLandmarks(ctx, lm, w, h) {
  lm.forEach((pt, i) => {
    // Mirror x (canvas is already mirrored via CSS but drawing is raw)
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === LM.INDEX_TIP ? '#00ff88' : 'rgba(0,212,255,0.85)';
    ctx.fill();
    // Glow ring
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

// Expose
window.GestureEngine = { initMediaPipe, startCamera };
