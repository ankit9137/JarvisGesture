'use strict';
/* JARVIS Stickman — walking target you can zap with lightning.
   - Walks back and forth across the bottom of the screen.
   - When a 'jarvis:bolt' or 'jarvis:shockwave' lands near him → ragdoll mode.
   - When ragdoll stops moving → springs back up and walks again.
   - Counter on screen tracks hits.
   - Multiple HP states: 0=walking, 1=zapped, 2=ragdoll, 3=respawning. */
(function () {
  // ---------- Config ----------
  var GROUND_Y_FACTOR = 0.85;     // 85% down the screen
  var BODY_SCALE = 1.0;
  var WALK_SPEED = 110;           // px/sec
  var HIT_RADIUS = 90;            // a bolt within this counts as a hit
  var SHOCK_RADIUS_BONUS = 60;
  var RAGDOLL_RECOVER_MS = 2200;  // time before springs back up
  var GRAVITY = 1400;             // px/sec^2 (ragdoll)
  var DAMPING = 0.985;
  var GROUND_BOUNCE = 0.45;
  var STIFFNESS = 0.42;           // constraint stiffness

  // ---------- Canvas ----------
  var canvas, ctx;
  var W = 0, H = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var rafId = 0;
  var lastFrame = 0;

  // ---------- Stickman skeleton (point-mass + constraints) ----------
  // Bone definition (length in body units; multiplied by BODY scale)
  var BODY = 56; // base size
  var BONES = [
    // points: head, neck, hip, lshoulder, lhand, rshoulder, rhand, lknee, lfoot, rknee, rfoot
    { name: 'head' },
    { name: 'neck' },
    { name: 'hip' },
    { name: 'lshoulder' },
    { name: 'lhand' },
    { name: 'rshoulder' },
    { name: 'rhand' },
    { name: 'lknee' },
    { name: 'lfoot' },
    { name: 'rknee' },
    { name: 'rfoot' }
  ];
  var IDX = { head:0, neck:1, hip:2, lshoulder:3, lhand:4, rshoulder:5, rhand:6, lknee:7, lfoot:8, rknee:9, rfoot:10 };
  // Constraint rest lengths in body units
  var CONSTRAINTS = [
    [IDX.head,      IDX.neck,      0.30],
    [IDX.neck,      IDX.hip,       0.55],
    [IDX.neck,      IDX.lshoulder, 0.25],
    [IDX.neck,      IDX.rshoulder, 0.25],
    [IDX.lshoulder, IDX.lhand,     0.55],
    [IDX.rshoulder, IDX.rhand,     0.55],
    [IDX.hip,       IDX.lknee,     0.45],
    [IDX.hip,       IDX.rknee,     0.45],
    [IDX.lknee,     IDX.lfoot,     0.45],
    [IDX.rknee,     IDX.rfoot,     0.45]
  ];

  // ---------- State ----------
  var state = 'walking'; // walking | ragdoll | recovering
  var stateSince = performance.now();
  var hits = 0;
  var facing = 1;                 // 1 = right, -1 = left
  var posX = 200;                 // walking anchor x
  var walkPhase = 0;
  var pts = [];                   // point masses: {x, y, px, py, mass}

  function bodyLen(units) { return units * BODY * BODY_SCALE; }

  function targetSkeleton(centerX, groundY) {
    // Walking pose targets relative to centerX and groundY
    // groundY is where the feet sit
    var t = walkPhase;
    var legSwing = Math.sin(t) * 18;
    var legLift  = Math.max(0, Math.sin(t)) * 12;
    var armSwingL = -Math.sin(t) * 28;
    var armSwingR = Math.sin(t) * 28;

    var hipY = groundY - bodyLen(0.9);
    var neckY = hipY - bodyLen(0.55);
    var headY = neckY - bodyLen(0.3);

    var shoulderOffsetX = bodyLen(0.22);
    var hipOffsetX = bodyLen(0.16);

    var targets = [];
    targets[IDX.head]      = { x: centerX,                          y: headY };
    targets[IDX.neck]      = { x: centerX,                          y: neckY };
    targets[IDX.hip]       = { x: centerX,                          y: hipY };
    targets[IDX.lshoulder] = { x: centerX - shoulderOffsetX,        y: neckY + 4 };
    targets[IDX.lhand]     = { x: centerX - shoulderOffsetX + armSwingL, y: neckY + bodyLen(0.55) };
    targets[IDX.rshoulder] = { x: centerX + shoulderOffsetX,        y: neckY + 4 };
    targets[IDX.rhand]     = { x: centerX + shoulderOffsetX + armSwingR, y: neckY + bodyLen(0.55) };
    targets[IDX.lknee]     = { x: centerX - hipOffsetX,             y: hipY + bodyLen(0.45) - legLift };
    targets[IDX.lfoot]     = { x: centerX - hipOffsetX + legSwing,  y: groundY };
    targets[IDX.rknee]     = { x: centerX + hipOffsetX,             y: hipY + bodyLen(0.45) - (Math.max(0, -Math.sin(t)) * 12) };
    targets[IDX.rfoot]     = { x: centerX + hipOffsetX - legSwing,  y: groundY };
    return targets;
  }

  function initSkeleton() {
    var groundY = H * GROUND_Y_FACTOR;
    var ts = targetSkeleton(posX, groundY);
    pts = [];
    for (var i = 0; i < BONES.length; i++) {
      pts.push({ x: ts[i].x, y: ts[i].y, px: ts[i].x, py: ts[i].y, mass: 1 });
    }
  }

  // ---------- Canvas setup ----------
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'stickman-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
      + 'pointer-events:none;z-index:24;'; // just below lightning-fx (25)
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (pts.length === 0) initSkeleton();
  }

  // ---------- Walking update ----------
  function updateWalking(dt) {
    walkPhase += dt * 6.0;
    posX += facing * WALK_SPEED * dt;
    var margin = 80;
    if (posX > W - margin) { posX = W - margin; facing = -1; }
    if (posX < margin)     { posX = margin;     facing = 1;  }
    var groundY = H * GROUND_Y_FACTOR;
    var ts = targetSkeleton(posX, groundY);
    // Lerp each point toward target
    for (var i = 0; i < pts.length; i++) {
      pts[i].x += (ts[i].x - pts[i].x) * 0.35;
      pts[i].y += (ts[i].y - pts[i].y) * 0.35;
      pts[i].px = pts[i].x;
      pts[i].py = pts[i].y;
    }
  }

  // ---------- Ragdoll physics ----------
  function updateRagdoll(dt) {
    var groundY = H * GROUND_Y_FACTOR + 8;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var vx = (p.x - p.px) * DAMPING;
      var vy = (p.y - p.py) * DAMPING + GRAVITY * dt * dt;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy;
      // Ground collision
      if (p.y > groundY) {
        p.y = groundY;
        // bounce + friction on the previous-position so verlet doesn't fight it
        p.py = p.y + vy * GROUND_BOUNCE;
        p.px = p.x - vx * 0.7;
      }
      // Side walls
      if (p.x < 10) { p.x = 10; p.px = p.x + (p.x - p.px) * 0.5; }
      if (p.x > W - 10) { p.x = W - 10; p.px = p.x + (p.x - p.px) * 0.5; }
    }
    // Apply constraints multiple times for stability
    for (var iter = 0; iter < 4; iter++) {
      for (var c = 0; c < CONSTRAINTS.length; c++) {
        var A = pts[CONSTRAINTS[c][0]];
        var B = pts[CONSTRAINTS[c][1]];
        var rest = bodyLen(CONSTRAINTS[c][2]);
        var dx = B.x - A.x;
        var dy = B.y - A.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var diff = (d - rest) / d * STIFFNESS;
        var ox = dx * diff * 0.5;
        var oy = dy * diff * 0.5;
        A.x += ox; A.y += oy;
        B.x -= ox; B.y -= oy;
      }
    }
  }

  // ---------- Hit / damage ----------
  function isHitBy(ax, ay, bx, by, radius) {
    // Distance from line segment to nearest body point
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = 0;
      if (len2 > 0) {
        t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
      }
      var cx = ax + dx * t, cy = ay + dy * t;
      var ddx = p.x - cx, ddy = p.y - cy;
      if (ddx * ddx + ddy * ddy < radius * radius) return { idx: i, point: p };
    }
    return null;
  }

  function applyImpulse(targetPt, ix, iy) {
    targetPt.px -= ix;
    targetPt.py -= iy;
    // Spread to nearby points half-strength
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p === targetPt) continue;
      var dx = p.x - targetPt.x;
      var dy = p.y - targetPt.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < 60 * 60) {
        var f = 1 - Math.sqrt(d2) / 60;
        p.px -= ix * f * 0.6;
        p.py -= iy * f * 0.6;
      }
    }
  }

  function hitByBolt(detail) {
    if (state === 'recovering') return;
    var radius = HIT_RADIUS;
    var hit = isHitBy(detail.ax, detail.ay, detail.bx, detail.by, radius);
    if (!hit) return;
    hits++;
    // Direction of impulse: along bolt direction
    var dx = detail.bx - detail.ax;
    var dy = detail.by - detail.ay;
    var L = Math.sqrt(dx * dx + dy * dy) || 1;
    var power = Math.min(3, detail.power || 1) * 22;
    applyImpulse(hit.point, (dx / L) * power, (dy / L) * power - 6);
    triggerRagdoll();
    // Big sparks via LightningFX
    if (window.LightningFX && window.LightningFX.sparks) {
      window.LightningFX.sparks(hit.point.x, hit.point.y, 14, '#ffff66');
    }
    if (window.JarvisBrain && window.JarvisBrain.say) {
      window.JarvisBrain.say('⚡ Stickman zapped! Hit #' + hits);
    }
    updateHitCounter();
  }

  function hitByShockwave(detail) {
    if (state === 'recovering') return;
    var dx = pts[IDX.hip].x - detail.x;
    var dy = pts[IDX.hip].y - detail.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var maxR = (detail.maxR || 320) + SHOCK_RADIUS_BONUS;
    if (d > maxR) return;
    var falloff = 1 - d / maxR;
    var power = (detail.intensity || 1) * 26 * falloff;
    var nx = (d > 0 ? dx / d : 0);
    var ny = (d > 0 ? dy / d : -1);
    for (var i = 0; i < pts.length; i++) {
      pts[i].px -= nx * power;
      pts[i].py -= ny * power - 4;
    }
    triggerRagdoll();
    hits++;
    updateHitCounter();
  }

  function triggerRagdoll() {
    state = 'ragdoll';
    stateSince = performance.now();
  }

  // ---------- Recover / respawn ----------
  function maybeRecover(now) {
    if (state !== 'ragdoll') return;
    // wait until motion settles AND min duration passed
    var settled = true;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (Math.abs(p.x - p.px) + Math.abs(p.y - p.py) > 0.5) { settled = false; break; }
    }
    if (settled && now - stateSince > RAGDOLL_RECOVER_MS) {
      state = 'recovering';
      stateSince = now;
      // Decide new anchor = hip x position
      posX = pts[IDX.hip].x;
      if (posX < 100) { posX = 100; facing = 1; }
      else if (posX > W - 100) { posX = W - 100; facing = -1; }
    }
    if (state === 'recovering') {
      // Lerp back to standing pose
      var groundY = H * GROUND_Y_FACTOR;
      var ts = targetSkeleton(posX, groundY);
      var doneCount = 0;
      for (var j = 0; j < pts.length; j++) {
        pts[j].x += (ts[j].x - pts[j].x) * 0.18;
        pts[j].y += (ts[j].y - pts[j].y) * 0.18;
        pts[j].px = pts[j].x;
        pts[j].py = pts[j].y;
        if (Math.abs(pts[j].x - ts[j].x) + Math.abs(pts[j].y - ts[j].y) < 2) doneCount++;
      }
      if (doneCount === pts.length || now - stateSince > 900) {
        state = 'walking';
        walkPhase = 0;
      }
    }
  }

  // ---------- Hit counter HUD ----------
  var counterEl = null;
  function ensureCounter() {
    if (counterEl) return;
    counterEl = document.createElement('div');
    counterEl.id = 'stickman-counter';
    counterEl.style.cssText = 'position:fixed;bottom:50px;left:50%;transform:translateX(-50%);'
      + 'background:rgba(0,20,35,0.85);border:1px solid rgba(0,212,255,0.6);color:#00ff88;'
      + 'font-family:"Courier New",monospace;font-size:12px;padding:6px 14px;letter-spacing:2px;'
      + 'box-shadow:0 0 12px rgba(0,212,255,0.4);z-index:9997;text-shadow:0 0 6px #00ff88;';
    counterEl.textContent = '⚡ STICKMAN HITS: 0';
    document.body.appendChild(counterEl);
  }
  function updateHitCounter() {
    if (!counterEl) ensureCounter();
    counterEl.textContent = '⚡ STICKMAN HITS: ' + hits;
    counterEl.style.transform = 'translateX(-50%) scale(1.18)';
    setTimeout(function () {
      if (counterEl) counterEl.style.transform = 'translateX(-50%) scale(1.0)';
    }, 120);
  }

  // ---------- Rendering ----------
  function drawStickman(now) {
    ctx.save();
    var glow = state === 'ragdoll' ? '#ff5566' : (state === 'recovering' ? '#ffe066' : '#00d4ff');
    ctx.strokeStyle = glow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    // Body bones
    function line(aI, bI) {
      ctx.beginPath();
      ctx.moveTo(pts[aI].x, pts[aI].y);
      ctx.lineTo(pts[bI].x, pts[bI].y);
      ctx.stroke();
    }
    // torso
    line(IDX.neck, IDX.hip);
    // arms
    line(IDX.neck, IDX.lshoulder); line(IDX.lshoulder, IDX.lhand);
    line(IDX.neck, IDX.rshoulder); line(IDX.rshoulder, IDX.rhand);
    // legs
    line(IDX.hip, IDX.lknee); line(IDX.lknee, IDX.lfoot);
    line(IDX.hip, IDX.rknee); line(IDX.rknee, IDX.rfoot);
    // Head (circle)
    ctx.fillStyle = 'rgba(0,20,35,0.95)';
    ctx.beginPath();
    var headR = bodyLen(0.18);
    ctx.arc(pts[IDX.head].x, pts[IDX.head].y, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Eyes
    var eyeOffset = headR * 0.4;
    var eyeY = pts[IDX.head].y - headR * 0.1;
    ctx.fillStyle = '#00ff88';
    ctx.shadowBlur = 6;
    if (state === 'ragdoll') ctx.fillStyle = '#ff5566';
    ctx.beginPath();
    ctx.arc(pts[IDX.head].x - eyeOffset, eyeY, 2, 0, Math.PI * 2);
    ctx.arc(pts[IDX.head].x + eyeOffset, eyeY, 2, 0, Math.PI * 2);
    ctx.fill();
    // Ground shadow under feet
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,212,255,0.15)';
    var feetY = Math.max(pts[IDX.lfoot].y, pts[IDX.rfoot].y);
    ctx.beginPath();
    ctx.ellipse((pts[IDX.lfoot].x + pts[IDX.rfoot].x) / 2, feetY + 4, 40, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Loop ----------
  function loop() {
    if (document.hidden) { rafId = 0; return; }
    var now = performance.now();
    var dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;

    ctx.clearRect(0, 0, W, H);

    if (state === 'walking') updateWalking(dt);
    else if (state === 'ragdoll') updateRagdoll(dt);
    maybeRecover(now);

    drawStickman(now);

    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId) return;
    rafId = requestAnimationFrame(loop);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !rafId) start();
    });
  }

  // ---------- Init + wire events ----------
  function init() {
    ensureCanvas();
    initSkeleton();
    ensureCounter();
    start();
    window.addEventListener('jarvis:bolt', function (ev) {
      if (ev && ev.detail) hitByBolt(ev.detail);
    });
    window.addEventListener('jarvis:shockwave', function (ev) {
      if (ev && ev.detail) hitByShockwave(ev.detail);
    });
    if (typeof console !== 'undefined' && console.log) {
      console.log('🚶 Stickman online — zap him with lightning to ragdoll!');
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
  window.Stickman = {
    position: function () {
      if (!pts.length) return null;
      return { x: pts[IDX.hip].x, y: pts[IDX.hip].y };
    },
    hits: function () { return hits; },
    reset: function () {
      hits = 0;
      updateHitCounter();
      state = 'walking';
      stateSince = performance.now();
      initSkeleton();
    },
    state: function () { return state; }
  };
})();
