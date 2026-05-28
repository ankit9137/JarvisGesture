'use strict';
/* JARVIS Lightning FX
   - Fullscreen canvas overlay.
   - Reads window.GestureHands every rAF and renders:
       1. Jagged lightning arcs between fingertips of a single hand on fast motion.
       2. THICK electricity arcing between TWO hands when both are visible.
       3. Sparks at fingertips on high velocity.
       4. Energy ring around palm scaled by hand "energy" (avg speed).
   - Pure 2D canvas, additive blending, GPU-friendly. */
(function () {
  var SPEED_TRIGGER_SOLO = 250;   // px/sec — single-hand arc threshold
  var SPEED_TRIGGER_DUAL = 0;     // dual-hand always electrifies between them
  var MAX_BOLTS_PER_FRAME = 6;
  var BOLT_LIFE = 220;            // ms
  var SPARK_LIFE = 600;
  var MAX_SPARKS = 80;

  var canvas, ctx;
  var W = 0, H = 0;
  var bolts = [];   // { points: [{x,y}], born, life, color, width }
  var sparks = [];  // { x, y, vx, vy, born, life, color }
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var rafId = 0;
  var lastFrame = 0;

  // Fingertip landmark indices (matches MediaPipe)
  var TIPS = [4, 8, 12, 16, 20];
  var INDEX_TIP = 8;
  var WRIST = 0;
  var MIDDLE_MCP = 9;

  // ---------- Setup ----------
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'lightning-fx';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
      + 'pointer-events:none;z-index:25;mix-blend-mode:screen;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- Bolt generator (jagged lightning between A and B) ----------
  function makeBolt(ax, ay, bx, by, opts) {
    opts = opts || {};
    var segs = opts.segs || 12;
    var jitter = opts.jitter || 22;
    var pts = [];
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len; // perpendicular
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var x = ax + dx * t;
      var y = ay + dy * t;
      // Taper jitter at endpoints (smooth-attach)
      var taper = Math.sin(t * Math.PI);
      var j = (Math.random() - 0.5) * jitter * taper;
      x += nx * j;
      y += ny * j;
      pts.push({ x: x, y: y });
    }
    return {
      points: pts,
      born: performance.now(),
      life: opts.life || BOLT_LIFE,
      color: opts.color || '#7df9ff',
      width: opts.width || 2,
      branchChance: opts.branchChance || 0.15
    };
  }

  function pushBolt(b) {
    bolts.push(b);
    if (bolts.length > 80) bolts.splice(0, bolts.length - 80);
  }

  function makeSparkBurst(x, y, count, color) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 60 + Math.random() * 180;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: performance.now(),
        life: SPARK_LIFE * (0.6 + Math.random() * 0.6),
        color: color || '#9deaff'
      });
    }
    if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
  }

  // ---------- Rendering ----------
  function drawBolt(b, now) {
    var age = now - b.born;
    var t = age / b.life;
    if (t >= 1) return false;
    var alpha = 1 - t;

    // Outer glow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = b.width + 6;
    strokePath(b.points);

    // Mid glow
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = b.width + 2;
    strokePath(b.points);

    // Core white-hot line
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, b.width - 0.5);
    strokePath(b.points);

    return true;
  }

  function strokePath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawSpark(s, now, dt) {
    var age = now - s.born;
    if (age >= s.life) return false;
    var t = age / s.life;
    s.x += s.vx * (dt / 1000);
    s.y += s.vy * (dt / 1000);
    s.vx *= 0.94;
    s.vy = s.vy * 0.94 + 280 * (dt / 1000); // gravity-ish drift down
    var alpha = (1 - t);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.2 * (1 - t * 0.6), 0, Math.PI * 2);
    ctx.fill();
    return true;
  }

  function drawEnergyRing(hand, now) {
    var p = hand.palmCenter;
    if (!p) return;
    var speed = hand.velocity ? hand.velocity.speed : 0;
    // Energy 0..1
    var e = Math.min(1, speed / 800);
    var baseR = 36 + e * 30;
    var pulse = Math.sin(now / 130) * 4;
    var r = baseR + pulse;
    ctx.save();
    ctx.globalAlpha = 0.35 + e * 0.45;
    ctx.strokeStyle = e > 0.4 ? '#ffff66' : '#00d4ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 1.5 + e * 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Second ring
    ctx.globalAlpha = 0.18 + e * 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Effect triggers from gesture state ----------
  function maybeSoloBolts(hand, now) {
    var v = hand.velocity || { speed: 0 };
    if (v.speed < SPEED_TRIGGER_SOLO) return;
    // Energy scales bolts
    var energy = Math.min(1, (v.speed - SPEED_TRIGGER_SOLO) / 700);
    var count = 1 + Math.round(energy * MAX_BOLTS_PER_FRAME);
    var lms = hand.landmarks;
    if (!lms || lms.length < 21) return;
    for (var i = 0; i < count; i++) {
      // Random fingertip → another tip or wrist
      var a = TIPS[(Math.random() * TIPS.length) | 0];
      var b = Math.random() < 0.5 ? WRIST : TIPS[(Math.random() * TIPS.length) | 0];
      if (a === b) continue;
      pushBolt(makeBolt(lms[a].x, lms[a].y, lms[b].x, lms[b].y, {
        segs: 8, jitter: 14 + energy * 18,
        width: 1.2 + energy * 1.6,
        color: energy > 0.55 ? '#ffff77' : '#7df9ff',
        life: 180 + energy * 200
      }));
    }
    // Spark burst at index tip on big motion
    if (v.speed > 600 && lms[INDEX_TIP]) {
      makeSparkBurst(lms[INDEX_TIP].x, lms[INDEX_TIP].y, 6, '#ffff99');
    }
  }

  function dualHandLightning(h1, h2, now) {
    // 2-3 arcs between the two index tips & palms every frame
    var l1 = h1.landmarks, l2 = h2.landmarks;
    if (!l1 || !l2) return;
    // Index→Index (main bolt)
    pushBolt(makeBolt(l1[INDEX_TIP].x, l1[INDEX_TIP].y, l2[INDEX_TIP].x, l2[INDEX_TIP].y, {
      segs: 16, jitter: 32,
      width: 2.5, color: '#a0f0ff',
      life: 160
    }));
    // Palm→Palm (background heavier bolt)
    pushBolt(makeBolt(h1.palmCenter.x, h1.palmCenter.y, h2.palmCenter.x, h2.palmCenter.y, {
      segs: 18, jitter: 42,
      width: 3.4, color: '#ffff88',
      life: 200
    }));
    // A random tip on each hand cross-arc
    var ta = TIPS[(Math.random() * TIPS.length) | 0];
    var tb = TIPS[(Math.random() * TIPS.length) | 0];
    pushBolt(makeBolt(l1[ta].x, l1[ta].y, l2[tb].x, l2[tb].y, {
      segs: 12, jitter: 22,
      width: 1.4, color: '#c8eaff',
      life: 140
    }));
    // Distance check — closer hands = more sparks
    var dx = h1.palmCenter.x - h2.palmCenter.x;
    var dy = h1.palmCenter.y - h2.palmCenter.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 280) {
      var midX = (h1.palmCenter.x + h2.palmCenter.x) / 2;
      var midY = (h1.palmCenter.y + h2.palmCenter.y) / 2;
      makeSparkBurst(midX, midY, 3, '#ffff99');
    }
  }

  // ---------- Main loop ----------
  function loop() {
    if (document.hidden) {
      rafId = 0;
      return;
    }
    var now = performance.now();
    var dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;

    // Trailing fade — partial clear for motion-blur
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter'; // additive

    var hands = window.GestureHands || [];

    // Per-hand effects
    for (var i = 0; i < hands.length; i++) {
      var h = hands[i];
      if (!h || !h.landmarks) continue;
      drawEnergyRing(h, now);
      maybeSoloBolts(h, now);
    }

    // Two-hand lightning
    if (hands.length >= 2) {
      dualHandLightning(hands[0], hands[1], now);
    }

    // Draw bolts
    var liveBolts = [];
    for (var b = 0; b < bolts.length; b++) {
      if (drawBolt(bolts[b], now)) liveBolts.push(bolts[b]);
    }
    bolts = liveBolts;

    // Draw sparks
    var liveSparks = [];
    for (var s = 0; s < sparks.length; s++) {
      if (drawSpark(sparks[s], now, dt)) liveSparks.push(sparks[s]);
    }
    sparks = liveSparks;

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
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

  function init() {
    ensureCanvas();
    start();
    if (typeof console !== 'undefined' && console.log) {
      console.log('⚡ Lightning FX online — wave your hands fast or show both hands for electricity');
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      setTimeout(init, 0);
    }
  }

  // Public API for manual triggers
  window.LightningFX = {
    bolt: function (ax, ay, bx, by, opts) { ensureCanvas(); pushBolt(makeBolt(ax, ay, bx, by, opts)); },
    sparks: function (x, y, n, color) { ensureCanvas(); makeSparkBurst(x, y, n || 12, color); }
  };
})();
