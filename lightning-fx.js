'use strict';
/* JARVIS Unified FX — Lightning + Stickman + Perf badge + Hotkeys
   ONE rAF loop, ONE canvas. Reads window.GestureHands / GestureState.
   Goals: smooth (single loop), bright dramatic lightning, walking stickman target.
   Hotkeys: Esc=pause, P=screenshot, R=reset hits, H=widgets toggle. */
(function () {
  // ============================================================
  //  CONFIG
  // ============================================================
  var DPR = Math.min(window.devicePixelRatio || 1, 1.25); // cap for perf
  var SOLO_SPEED = 360;            // px/sec to trigger solo bolts
  var BOLT_LIFE = 240;             // ms
  var MAX_BOLTS = 24;
  var IDLE_SPEED = 30;
  var GROUND_Y = 0.86;             // factor of screen height for stickman feet
  var WALK_SPEED = 130;
  var HIT_RADIUS = 95;
  var GRAVITY = 1500;
  var DAMPING = 0.984;
  var STIFFNESS = 0.45;
  var RAGDOLL_RECOVER = 2000;

  // ============================================================
  //  STATE
  // ============================================================
  var canvas, ctx;
  var W = 0, H = 0;
  var paused = false;
  var screenFlash = 0;       // 0..1, decays each frame
  var bolts = [];
  var sparks = [];

  // Stickman
  var IDX = { head:0, neck:1, hip:2, lsh:3, lhand:4, rsh:5, rhand:6, lknee:7, lfoot:8, rknee:9, rfoot:10 };
  var BONE_LEN = 56;
  var CONSTRAINTS = [
    [0,1,0.30],[1,2,0.55],
    [1,3,0.25],[1,5,0.25],
    [3,4,0.55],[5,6,0.55],
    [2,7,0.45],[2,9,0.45],
    [7,8,0.45],[9,10,0.45]
  ];
  var pts = [];
  var stickState = 'walking'; // walking | ragdoll | recovering
  var stickStateSince = 0;
  var stickX = 200, stickFacing = 1, walkPhase = 0;
  var hits = 0;

  // ============================================================
  //  CANVAS
  // ============================================================
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'jarvis-fx';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:25;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: true });
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (pts.length === 0) initStickman();
  }

  // ============================================================
  //  LIGHTNING — bolt generator with BRANCHING (the dramatic part)
  // ============================================================
  function makeBolt(ax, ay, bx, by, opts) {
    opts = opts || {};
    var pwr = opts.power || 1;
    var segs = opts.segs || (10 + Math.round(pwr * 6));
    var jitter = opts.jitter || (24 + pwr * 14);
    var pts0 = subdivide(ax, ay, bx, by, segs, jitter);
    // Branches: fork off at random midpoints
    var branches = [];
    var branchCount = opts.branches != null ? opts.branches : Math.round(1 + pwr * 3);
    for (var i = 0; i < branchCount; i++) {
      var idx = 2 + Math.floor(Math.random() * (pts0.length - 4));
      var bp = pts0[idx];
      var dx = bx - ax, dy = by - ay;
      var blen = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.4;
      var blen2 = blen * (0.18 + Math.random() * 0.32);
      var tx = bp.x + Math.cos(ang) * blen2;
      var ty = bp.y + Math.sin(ang) * blen2;
      branches.push(subdivide(bp.x, bp.y, tx, ty, 6, jitter * 0.6));
    }
    return {
      main: pts0,
      branches: branches,
      born: performance.now(),
      life: opts.life || BOLT_LIFE,
      color: opts.color || '#9ff0ff',
      width: opts.width || (2 + pwr * 1.6),
      power: pwr,
      flash: opts.flash || 0
    };
  }
  function subdivide(ax, ay, bx, by, segs, jit) {
    var pts0 = [{ x: ax, y: ay }];
    var dx = bx - ax, dy = by - ay;
    var nx = -dy, ny = dx;
    var nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nlen; ny /= nlen;
    for (var i = 1; i < segs; i++) {
      var t = i / segs;
      var taper = Math.sin(t * Math.PI);
      var j = (Math.random() - 0.5) * jit * taper;
      pts0.push({ x: ax + dx * t + nx * j, y: ay + dy * t + ny * j });
    }
    pts0.push({ x: bx, y: by });
    return pts0;
  }

  function pushBolt(b) {
    bolts.push(b);
    if (bolts.length > MAX_BOLTS) bolts.splice(0, bolts.length - MAX_BOLTS);
    if (b.flash) screenFlash = Math.min(1, screenFlash + b.flash);
    // hit-test against stickman
    testStickHit(b);
  }

  function makeSparks(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 80 + Math.random() * 240;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        born: performance.now(), life: 500 + Math.random() * 400,
        color: color || '#bff'
      });
    }
    if (sparks.length > 80) sparks.splice(0, sparks.length - 80);
  }

  // ============================================================
  //  DRAW LIGHTNING — multi-pass for that bright sci-fi look
  // ============================================================
  function strokePts(p) {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (var i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.stroke();
  }

  function drawBolt(b, now) {
    var age = now - b.born;
    if (age >= b.life) return false;
    var t = age / b.life;
    var alpha = 1 - t;
    var W0 = b.width;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // PASS 1 — wide haze
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 28;
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = W0 + 14;
    strokePts(b.main);
    for (var i = 0; i < b.branches.length; i++) strokePts(b.branches[i]);

    // PASS 2 — bright color glow
    ctx.shadowBlur = 14;
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = W0 + 4;
    strokePts(b.main);
    for (var j = 0; j < b.branches.length; j++) strokePts(b.branches[j]);

    // PASS 3 — white-hot core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.4, W0 * 0.55);
    strokePts(b.main);
    ctx.lineWidth = Math.max(1, W0 * 0.35);
    for (var k = 0; k < b.branches.length; k++) strokePts(b.branches[k]);

    return true;
  }

  function drawSpark(s, now, dt) {
    var age = now - s.born;
    if (age >= s.life) return false;
    var t = age / s.life;
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vx *= 0.93;
    s.vy = s.vy * 0.93 + 380 * dt;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.4 * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
    return true;
  }

  // ============================================================
  //  HAND-DRIVEN BOLTS
  // ============================================================
  var TIPS = [4, 8, 12, 16, 20];
  function handBolts(hand) {
    var v = hand.velocity || { speed: 0 };
    if (v.speed < SOLO_SPEED) return;
    var energy = Math.min(1, (v.speed - SOLO_SPEED) / 800);
    var lms = hand.landmarks;
    if (!lms || lms.length < 21) return;
    // ONE dramatic bolt per frame (not many) — looks better than spam
    var a = TIPS[(Math.random() * TIPS.length) | 0];
    var b = TIPS[(Math.random() * TIPS.length) | 0];
    if (a === b) b = 0; // wrist
    pushBolt(makeBolt(lms[a].x, lms[a].y, lms[b].x, lms[b].y, {
      power: 0.8 + energy * 1.2,
      color: energy > 0.5 ? '#ffe14d' : '#7df2ff',
      branches: 2 + Math.round(energy * 3),
      flash: energy > 0.7 ? 0.15 : 0,
      life: 220 + energy * 120
    }));
    if (energy > 0.6 && lms[8]) {
      makeSparks(lms[8].x, lms[8].y, 5, '#ffec80');
    }
  }

  function dualBolts(h1, h2) {
    var l1 = h1.landmarks, l2 = h2.landmarks;
    if (!l1 || !l2) return;
    // Index→Index huge bolt
    pushBolt(makeBolt(l1[8].x, l1[8].y, l2[8].x, l2[8].y, {
      power: 2.2, color: '#a0f0ff', branches: 5, life: 200, flash: 0.18
    }));
    // Distance check — close hands burst sparks
    var dx = h1.palmCenter.x - h2.palmCenter.x;
    var dy = h1.palmCenter.y - h2.palmCenter.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 260) {
      var mx = (h1.palmCenter.x + h2.palmCenter.x) / 2;
      var my = (h1.palmCenter.y + h2.palmCenter.y) / 2;
      makeSparks(mx, my, 4, '#fffacd');
    }
  }

  // Energy ring at palm — small, cheap, scales with speed
  function drawPalmRing(hand, now) {
    var p = hand.palmCenter;
    if (!p) return;
    var v = hand.velocity ? hand.velocity.speed : 0;
    var e = Math.min(1, v / 700);
    var r = 32 + e * 22 + Math.sin(now / 140) * 3;
    ctx.save();
    ctx.globalAlpha = 0.4 + e * 0.4;
    ctx.strokeStyle = e > 0.4 ? '#ffd84d' : '#00d4ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2 + e * 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================
  //  STICKMAN
  // ============================================================
  function bodyLen(u) { return u * BONE_LEN; }

  function targetSkeleton(cx, gy) {
    var t = walkPhase;
    var sw = Math.sin(t) * 18;
    var lift = Math.max(0, Math.sin(t)) * 14;
    var armL = -Math.sin(t) * 30;
    var armR = Math.sin(t) * 30;
    var hipY = gy - bodyLen(0.9);
    var neckY = hipY - bodyLen(0.55);
    var headY = neckY - bodyLen(0.3);
    var shx = bodyLen(0.22), hpx = bodyLen(0.16);
    var ts = [];
    ts[0]  = { x: cx,        y: headY };
    ts[1]  = { x: cx,        y: neckY };
    ts[2]  = { x: cx,        y: hipY };
    ts[3]  = { x: cx - shx,  y: neckY + 4 };
    ts[4]  = { x: cx - shx + armL, y: neckY + bodyLen(0.55) };
    ts[5]  = { x: cx + shx,  y: neckY + 4 };
    ts[6]  = { x: cx + shx + armR, y: neckY + bodyLen(0.55) };
    ts[7]  = { x: cx - hpx,  y: hipY + bodyLen(0.45) - lift };
    ts[8]  = { x: cx - hpx + sw, y: gy };
    ts[9]  = { x: cx + hpx,  y: hipY + bodyLen(0.45) - Math.max(0, -Math.sin(t)) * 14 };
    ts[10] = { x: cx + hpx - sw, y: gy };
    return ts;
  }

  function initStickman() {
    var gy = H * GROUND_Y;
    var ts = targetSkeleton(stickX, gy);
    pts = [];
    for (var i = 0; i < 11; i++) {
      pts.push({ x: ts[i].x, y: ts[i].y, px: ts[i].x, py: ts[i].y });
    }
  }

  function updateWalking(dt) {
    walkPhase += dt * 7;
    stickX += stickFacing * WALK_SPEED * dt;
    if (stickX > W - 80) { stickX = W - 80; stickFacing = -1; }
    if (stickX < 80) { stickX = 80; stickFacing = 1; }
    var gy = H * GROUND_Y;
    var ts = targetSkeleton(stickX, gy);
    for (var i = 0; i < pts.length; i++) {
      pts[i].x += (ts[i].x - pts[i].x) * 0.38;
      pts[i].y += (ts[i].y - pts[i].y) * 0.38;
      pts[i].px = pts[i].x;
      pts[i].py = pts[i].y;
    }
  }

  function updateRagdoll(dt) {
    var gy = H * GROUND_Y + 8;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var vx = (p.x - p.px) * DAMPING;
      var vy = (p.y - p.py) * DAMPING + GRAVITY * dt * dt;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy;
      if (p.y > gy) {
        p.y = gy;
        p.py = p.y + vy * 0.45;
        p.px = p.x - vx * 0.7;
      }
      if (p.x < 10) { p.x = 10; p.px = p.x + (p.x - p.px) * 0.5; }
      if (p.x > W - 10) { p.x = W - 10; p.px = p.x + (p.x - p.px) * 0.5; }
    }
    // Constraint solver — 3 iterations is plenty
    for (var iter = 0; iter < 3; iter++) {
      for (var c = 0; c < CONSTRAINTS.length; c++) {
        var A = pts[CONSTRAINTS[c][0]];
        var B = pts[CONSTRAINTS[c][1]];
        var rest = bodyLen(CONSTRAINTS[c][2]);
        var dx = B.x - A.x, dy = B.y - A.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var diff = (d - rest) / d * STIFFNESS;
        var ox = dx * diff * 0.5, oy = dy * diff * 0.5;
        A.x += ox; A.y += oy;
        B.x -= ox; B.y -= oy;
      }
    }
  }

  function testStickHit(b) {
    if (stickState === 'recovering') return;
    var pts0 = b.main;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      for (var s = 0; s < pts0.length - 1; s++) {
        var a = pts0[s], b1 = pts0[s + 1];
        var dx = b1.x - a.x, dy = b1.y - a.y;
        var len2 = dx * dx + dy * dy;
        var t = 0;
        if (len2 > 0) {
          t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
        }
        var cx = a.x + dx * t, cy = a.y + dy * t;
        var ddx = p.x - cx, ddy = p.y - cy;
        if (ddx * ddx + ddy * ddy < HIT_RADIUS * HIT_RADIUS) {
          // HIT!
          hits++;
          updateBadge();
          // Impulse along bolt direction
          var bdx = pts0[pts0.length-1].x - pts0[0].x;
          var bdy = pts0[pts0.length-1].y - pts0[0].y;
          var bL = Math.sqrt(bdx*bdx+bdy*bdy) || 1;
          var pwr = (b.power || 1) * 26;
          p.px -= (bdx/bL) * pwr;
          p.py -= (bdy/bL) * pwr - 6;
          stickState = 'ragdoll';
          stickStateSince = performance.now();
          makeSparks(p.x, p.y, 14, '#ffec80');
          screenFlash = Math.min(1, screenFlash + 0.25);
          if (window.JarvisBrain && window.JarvisBrain.say) {
            window.JarvisBrain.say('⚡ Zap! Hit #' + hits);
          }
          return;
        }
      }
    }
  }

  function maybeRecover(now) {
    if (stickState !== 'ragdoll') return;
    var settled = true;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (Math.abs(p.x - p.px) + Math.abs(p.y - p.py) > 0.6) { settled = false; break; }
    }
    if (settled && now - stickStateSince > RAGDOLL_RECOVER) {
      stickState = 'recovering';
      stickStateSince = now;
      stickX = pts[2].x;
      if (stickX < 100) { stickX = 100; stickFacing = 1; }
      else if (stickX > W - 100) { stickX = W - 100; stickFacing = -1; }
    }
    if (stickState === 'recovering') {
      var gy = H * GROUND_Y;
      var ts = targetSkeleton(stickX, gy);
      for (var j = 0; j < pts.length; j++) {
        pts[j].x += (ts[j].x - pts[j].x) * 0.2;
        pts[j].y += (ts[j].y - pts[j].y) * 0.2;
        pts[j].px = pts[j].x;
        pts[j].py = pts[j].y;
      }
      if (now - stickStateSince > 800) {
        stickState = 'walking';
        walkPhase = 0;
      }
    }
  }

  function drawStickman() {
    ctx.save();
    var glow = stickState === 'ragdoll' ? '#ff5566' :
               stickState === 'recovering' ? '#ffe066' : '#00d4ff';
    ctx.strokeStyle = glow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    function L(i, j) {
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[j].x, pts[j].y);
      ctx.stroke();
    }
    L(1,2); L(1,3); L(3,4); L(1,5); L(5,6);
    L(2,7); L(7,8); L(2,9); L(9,10);
    // Head
    ctx.fillStyle = 'rgba(0,18,32,0.95)';
    var hr = bodyLen(0.18);
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Eyes
    ctx.shadowBlur = 6;
    ctx.fillStyle = stickState === 'ragdoll' ? '#ff5566' : '#00ff88';
    var eo = hr * 0.4, ey = pts[0].y - hr * 0.1;
    ctx.beginPath();
    ctx.arc(pts[0].x - eo, ey, 2, 0, Math.PI * 2);
    ctx.arc(pts[0].x + eo, ey, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ============================================================
  //  PERF BADGE + HOTKEYS
  // ============================================================
  var badge = null;
  var fpsAvg = 60;
  var lastFpsTs = 0;
  function ensureBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;bottom:50px;left:14px;z-index:9996;' +
      'background:rgba(0,20,35,0.85);border:1px solid rgba(0,212,255,0.6);' +
      'color:#00ff88;font-family:"Courier New",monospace;font-size:11px;' +
      'padding:4px 10px;letter-spacing:1.5px;box-shadow:0 0 8px rgba(0,212,255,0.4);' +
      'pointer-events:none;';
    badge.textContent = 'FPS:-- HITS:0';
    document.body.appendChild(badge);
  }
  function updateBadge() {
    if (!badge) return;
    var color = fpsAvg > 50 ? '#00ff88' : fpsAvg > 32 ? '#ffe066' : '#ff5566';
    badge.style.color = color;
    badge.textContent = 'FPS:' + Math.round(fpsAvg) + ' HITS:' + hits;
  }
  var pauseOverlay = null;
  function ensurePauseOverlay() {
    if (pauseOverlay) return;
    pauseOverlay = document.createElement('div');
    pauseOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);' +
      'z-index:99999;display:none;align-items:center;justify-content:center;' +
      'color:#ff5566;font-family:"Courier New",monospace;font-size:42px;' +
      'letter-spacing:8px;text-shadow:0 0 24px #ff5566;pointer-events:none;';
    pauseOverlay.textContent = '⏸ PAUSED — ESC TO RESUME';
    document.body.appendChild(pauseOverlay);
  }
  function togglePause() {
    paused = !paused;
    if (window.GestureState) window.GestureState.paused = paused;
    if (pauseOverlay) pauseOverlay.style.display = paused ? 'flex' : 'none';
  }
  function resetHits() {
    hits = 0;
    stickState = 'walking';
    stickStateSince = performance.now();
    initStickman();
    updateBadge();
  }

  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') { e.preventDefault(); togglePause(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetHits(); }
    else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (window.html2canvas) {
        window.html2canvas(document.body).then(function (c) {
          var a = document.createElement('a');
          a.href = c.toDataURL('image/png');
          a.download = 'jarvis-' + Date.now() + '.png';
          a.click();
        }).catch(function () {});
      }
    }
  });

  // ============================================================
  //  MAIN LOOP — single rAF, drives everything
  // ============================================================
  var lastFrame = 0;
  var rafId = 0;
  function loop() {
    if (document.hidden || paused) { rafId = 0; return; }
    var now = performance.now();
    var dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;

    // FPS calc
    if (lastFpsTs) {
      var instant = 1000 / (now - lastFpsTs);
      fpsAvg = fpsAvg * 0.92 + instant * 0.08;
    }
    lastFpsTs = now;
    if (Math.random() < 0.05) updateBadge();

    // Clear — full clear is FASTER than trail-fade on most GPUs at this DPR
    ctx.clearRect(0, 0, W, H);

    // Screen flash overlay (white tint) — decays
    if (screenFlash > 0.01) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,' + (screenFlash * 0.25) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      screenFlash *= 0.78;
    }

    // ---- Stickman update + draw ----
    if (stickState === 'walking') updateWalking(dt);
    else if (stickState === 'ragdoll') updateRagdoll(dt);
    maybeRecover(now);
    drawStickman();

    // ---- Hand-driven FX ----
    var hands = window.GestureHands || [];
    ctx.globalCompositeOperation = 'lighter'; // additive — makes bolts glow
    for (var i = 0; i < hands.length; i++) {
      var h = hands[i];
      if (!h || !h.landmarks) continue;
      drawPalmRing(h, now);
      handBolts(h);
    }
    if (hands.length >= 2) dualBolts(hands[0], hands[1]);

    // ---- Draw bolts ----
    var live = [];
    for (var b = 0; b < bolts.length; b++) {
      if (drawBolt(bolts[b], now)) live.push(bolts[b]);
    }
    bolts = live;

    // ---- Sparks ----
    var liveS = [];
    for (var s = 0; s < sparks.length; s++) {
      if (drawSpark(sparks[s], now, dt)) liveS.push(sparks[s]);
    }
    sparks = liveS;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId) return;
    rafId = requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !rafId && !paused) start();
  });

  function init() {
    ensureCanvas();
    ensureBadge();
    ensurePauseOverlay();
    initStickman();
    updateBadge();
    start();
    if (typeof console !== 'undefined') {
      console.log('⚡ JARVIS Unified FX — single-loop, lightning + stickman + hotkeys');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  // Public API
  window.LightningFX = {
    bolt: function (ax, ay, bx, by, opts) { ensureCanvas(); pushBolt(makeBolt(ax, ay, bx, by, opts)); },
    sparks: function (x, y, n, color) { ensureCanvas(); makeSparks(x, y, n || 12, color); }
  };
  window.Stickman = {
    reset: resetHits,
    hits: function () { return hits; }
  };
})();
