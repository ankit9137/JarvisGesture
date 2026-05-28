'use strict';
/* JARVIS Lightning FX v2 — perf-tuned + cursor + shockwave + energy ball
   - Single rAF loop, idle-skip, adaptive DPR.
   - Reads window.GestureHands; exposes window.LightningFX for other modules.
   - Emits CustomEvent 'jarvis:bolt' (detail = {ax,ay,bx,by,power,color}) so
     stickman.js can detect hits.
   - Listens for window.GestureState (primary hand gestures): OPEN_PALM push = shockwave,
     OK = energy ball, INDEX_UP = glowing cursor. */
(function () {
  // ---------- Tunables ----------
  var SPEED_TRIGGER_SOLO = 280;
  var MAX_BOLTS_PER_FRAME = 5;
  var BOLT_LIFE = 200;
  var SPARK_LIFE = 550;
  var MAX_SPARKS = 60;
  var IDLE_SPEED = 25;            // below this on all hands = sleep mode
  var IDLE_SLEEP_MS = 600;        // sleep delay after going idle
  var TARGET_FPS = 60;
  var LOW_FPS_THRESHOLD = 38;     // adaptive trigger

  // Fingertip / wrist indices
  var TIPS = [4, 8, 12, 16, 20];
  var INDEX_TIP = 8, WRIST = 0, MIDDLE_MCP = 9;

  // ---------- State ----------
  var canvas, ctx;
  var W = 0, H = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap at 1.5 for perf
  var bolts = [];
  var sparks = [];
  var shockwaves = [];   // {x,y,r,maxR,born,life,color,intensity}
  var energyBalls = [];  // {x,y,radius,charge,born,gesture}
  var rafId = 0;
  var lastFrame = 0;
  var lastActive = 0;
  var asleep = false;

  // Adaptive perf
  var fpsAvg = 60;
  var fpsLastTs = 0;
  var qualityScale = 1.0;  // 1.0 = max, 0.5 = half-cost

  // Cursor (INDEX_UP)
  var cursor = { x: -100, y: -100, visible: false, glow: 0, pinch: false };

  // Hand-push tracking for OPEN_PALM force gesture
  var palmZHistory = [];

  // ---------- Boot canvas ----------
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
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- Bolt generator ----------
  function makeBolt(ax, ay, bx, by, opts) {
    opts = opts || {};
    var segs = Math.round((opts.segs || 12) * qualityScale);
    if (segs < 4) segs = 4;
    var jitter = opts.jitter || 22;
    var pts = [];
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var taper = Math.sin(t * Math.PI);
      var j = (Math.random() - 0.5) * jitter * taper;
      pts.push({ x: ax + dx * t + nx * j, y: ay + dy * t + ny * j });
    }
    return {
      points: pts,
      born: performance.now(),
      life: opts.life || BOLT_LIFE,
      color: opts.color || '#7df9ff',
      width: opts.width || 2,
      power: opts.power || 1
    };
  }

  function pushBolt(b) {
    bolts.push(b);
    if (bolts.length > 70) bolts.splice(0, bolts.length - 70);
    // Tell the world a bolt was fired so stickman.js can detect hits
    try {
      var p1 = b.points[0], p2 = b.points[b.points.length - 1];
      window.dispatchEvent(new CustomEvent('jarvis:bolt', {
        detail: { ax: p1.x, ay: p1.y, bx: p2.x, by: p2.y, points: b.points, power: b.power, color: b.color }
      }));
    } catch (e) { /* ignore */ }
  }

  function makeSparkBurst(x, y, count, color) {
    count = Math.round(count * qualityScale);
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 60 + Math.random() * 200;
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

  // ---------- Shockwave ----------
  function spawnShockwave(x, y, intensity) {
    intensity = intensity || 1;
    shockwaves.push({
      x: x, y: y,
      r: 20, maxR: 320 + intensity * 220,
      born: performance.now(),
      life: 700 + intensity * 200,
      color: intensity > 1.2 ? '#ffe066' : '#a0f0ff',
      intensity: intensity
    });
    makeSparkBurst(x, y, 12, '#ffff99');
    // Tell stickman about the shockwave for knockback
    try {
      window.dispatchEvent(new CustomEvent('jarvis:shockwave', {
        detail: { x: x, y: y, intensity: intensity, maxR: 320 + intensity * 220 }
      }));
    } catch (e) {}
  }

  function drawShockwave(sw, now) {
    var age = now - sw.born;
    var t = age / sw.life;
    if (t >= 1) return false;
    sw.r = 20 + (sw.maxR - 20) * t;
    var alpha = (1 - t) * 0.9;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sw.color;
    ctx.shadowColor = sw.color;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 4 * (1 - t * 0.4);
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
    ctx.stroke();
    // Inner ring
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  // ---------- Energy ball (OK gesture) ----------
  function updateEnergyBalls(now) {
    // Active only if primary hand currently makes OK
    var gs = window.GestureState;
    var present = gs && gs.gesture === 'OK' && gs.indexTip;
    if (present) {
      if (energyBalls.length === 0) {
        energyBalls.push({ x: 0, y: 0, radius: 14, charge: 0, born: now });
      }
      var ball = energyBalls[0];
      // Position at palm center (mid index-tip + thumb-tip)
      var hand = (window.GestureHands || [])[0];
      if (hand && hand.landmarks) {
        var tx = (hand.landmarks[4].x + hand.landmarks[8].x) / 2;
        var ty = (hand.landmarks[4].y + hand.landmarks[8].y) / 2;
        ball.x = ball.x === 0 ? tx : ball.x + (tx - ball.x) * 0.4;
        ball.y = ball.y === 0 ? ty : ball.y + (ty - ball.y) * 0.4;
      }
      ball.charge = Math.min(1, ball.charge + 0.018);
      ball.radius = 14 + ball.charge * 26;
    } else {
      // Release on let-go: throw a big bolt if fully charged
      if (energyBalls.length > 0) {
        var b0 = energyBalls[0];
        if (b0.charge > 0.6) {
          // Release as a powerful bolt to the nearest stickman or center
          var tx2 = W / 2, ty2 = H / 2;
          if (window.Stickman && window.Stickman.position) {
            var pos = window.Stickman.position();
            if (pos) { tx2 = pos.x; ty2 = pos.y; }
          }
          pushBolt(makeBolt(b0.x, b0.y, tx2, ty2, {
            segs: 18, jitter: 38, width: 3.5, power: 3, color: '#ffe066', life: 320
          }));
          makeSparkBurst(b0.x, b0.y, 18, '#ffff66');
          spawnShockwave(b0.x, b0.y, 1.2);
        }
        energyBalls.length = 0;
      }
    }
  }

  function drawEnergyBall(b, now) {
    var t = (now - b.born) / 1000;
    var pulse = Math.sin(t * 8) * 3;
    // Outer aura
    ctx.save();
    ctx.globalAlpha = 0.35 + b.charge * 0.35;
    var grad = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.radius + 20 + pulse);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, b.charge > 0.7 ? '#ffe066' : '#7df9ff');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius + 20 + pulse, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = b.charge > 0.7 ? '#ffe066' : '#7df9ff';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 0.45 + pulse * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Internal lightning
    if (Math.random() < 0.7) {
      var a = Math.random() * Math.PI * 2;
      var r1 = b.radius * 0.2;
      var r2 = b.radius * 0.85;
      pushBolt(makeBolt(
        b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1,
        b.x + Math.cos(a) * r2, b.y + Math.sin(a) * r2,
        { segs: 6, jitter: 8, width: 1, life: 90, color: '#ffffff', power: 0.5 }
      ));
    }
    ctx.restore();
  }

  // ---------- Cursor (INDEX_UP) ----------
  function updateCursor(now) {
    var gs = window.GestureState;
    var show = gs && (gs.gesture === 'INDEX_UP' || gs.gesture === 'PINCH') && gs.indexTip;
    if (show) {
      var tx = gs.indexTip.x, ty = gs.indexTip.y;
      cursor.x = cursor.visible ? cursor.x + (tx - cursor.x) * 0.5 : tx;
      cursor.y = cursor.visible ? cursor.y + (ty - cursor.y) * 0.5 : ty;
      cursor.visible = true;
      cursor.glow = Math.min(1, cursor.glow + 0.1);
      var nowPinch = gs.gesture === 'PINCH';
      if (nowPinch && !cursor.pinch) {
        // Click event
        makeSparkBurst(cursor.x, cursor.y, 10, '#ffe066');
        spawnShockwave(cursor.x, cursor.y, 0.5);
        try {
          window.dispatchEvent(new CustomEvent('jarvis:click', { detail: { x: cursor.x, y: cursor.y } }));
        } catch (e) {}
      }
      cursor.pinch = nowPinch;
    } else {
      cursor.glow *= 0.92;
      if (cursor.glow < 0.05) cursor.visible = false;
      cursor.pinch = false;
    }
  }

  function drawCursor(now) {
    if (!cursor.visible && cursor.glow < 0.05) return;
    var pulse = Math.sin(now / 90) * 2;
    ctx.save();
    ctx.globalAlpha = cursor.glow;
    // Outer ring
    ctx.strokeStyle = cursor.pinch ? '#ffe066' : '#00ff88';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 18 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    // Inner dot
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // Cross-hairs
    ctx.strokeStyle = ctx.shadowColor;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    var L = 26;
    ctx.beginPath();
    ctx.moveTo(cursor.x - L, cursor.y); ctx.lineTo(cursor.x - 22, cursor.y);
    ctx.moveTo(cursor.x + 22, cursor.y); ctx.lineTo(cursor.x + L, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - L); ctx.lineTo(cursor.x, cursor.y - 22);
    ctx.moveTo(cursor.x, cursor.y + 22); ctx.lineTo(cursor.x, cursor.y + L);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Force push detector (OPEN_PALM thrust toward camera) ----------
  function detectForcePush() {
    var hand = (window.GestureHands || [])[0];
    if (!hand || hand.gesture !== 'OPEN_PALM') {
      palmZHistory.length = 0;
      return;
    }
    var v = hand.velocity || { speed: 0 };
    palmZHistory.push(v.speed);
    if (palmZHistory.length > 8) palmZHistory.shift();
    // sudden speed spike = push
    if (palmZHistory.length === 8) {
      var recent = (palmZHistory[6] + palmZHistory[7]) / 2;
      var earlier = (palmZHistory[0] + palmZHistory[1] + palmZHistory[2]) / 3;
      if (recent > 400 && recent > earlier * 2.4) {
        spawnShockwave(hand.palmCenter.x, hand.palmCenter.y, 1.4);
        palmZHistory.length = 0; // cooldown
      }
    }
  }

  // ---------- Solo bolts ----------
  function maybeSoloBolts(hand) {
    var v = hand.velocity || { speed: 0 };
    if (v.speed < SPEED_TRIGGER_SOLO) return;
    var energy = Math.min(1, (v.speed - SPEED_TRIGGER_SOLO) / 700);
    var count = 1 + Math.round(energy * MAX_BOLTS_PER_FRAME * qualityScale);
    var lms = hand.landmarks;
    if (!lms || lms.length < 21) return;
    for (var i = 0; i < count; i++) {
      var a = TIPS[(Math.random() * TIPS.length) | 0];
      var b = Math.random() < 0.5 ? WRIST : TIPS[(Math.random() * TIPS.length) | 0];
      if (a === b) continue;
      pushBolt(makeBolt(lms[a].x, lms[a].y, lms[b].x, lms[b].y, {
        segs: 8, jitter: 14 + energy * 18,
        width: 1.2 + energy * 1.6,
        color: energy > 0.55 ? '#ffff77' : '#7df9ff',
        life: 180 + energy * 200,
        power: 0.6 + energy * 0.8
      }));
    }
    if (v.speed > 700 && lms[INDEX_TIP]) {
      makeSparkBurst(lms[INDEX_TIP].x, lms[INDEX_TIP].y, 5, '#ffff99');
    }
  }

  // ---------- Dual-hand electricity ----------
  function dualHandLightning(h1, h2) {
    var l1 = h1.landmarks, l2 = h2.landmarks;
    if (!l1 || !l2) return;
    pushBolt(makeBolt(l1[INDEX_TIP].x, l1[INDEX_TIP].y, l2[INDEX_TIP].x, l2[INDEX_TIP].y, {
      segs: 14, jitter: 30, width: 2.4, color: '#a0f0ff', life: 160, power: 1.2
    }));
    pushBolt(makeBolt(h1.palmCenter.x, h1.palmCenter.y, h2.palmCenter.x, h2.palmCenter.y, {
      segs: 16, jitter: 40, width: 3.2, color: '#ffff88', life: 200, power: 1.8
    }));
    var ta = TIPS[(Math.random() * TIPS.length) | 0];
    var tb = TIPS[(Math.random() * TIPS.length) | 0];
    pushBolt(makeBolt(l1[ta].x, l1[ta].y, l2[tb].x, l2[tb].y, {
      segs: 10, jitter: 20, width: 1.4, color: '#c8eaff', life: 140, power: 0.9
    }));
    var dx = h1.palmCenter.x - h2.palmCenter.x;
    var dy = h1.palmCenter.y - h2.palmCenter.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 280) {
      var midX = (h1.palmCenter.x + h2.palmCenter.x) / 2;
      var midY = (h1.palmCenter.y + h2.palmCenter.y) / 2;
      makeSparkBurst(midX, midY, 3, '#ffff99');
    }
  }

  // ---------- Renderers ----------
  function strokePath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawBolt(b, now) {
    var age = now - b.born;
    var t = age / b.life;
    if (t >= 1) return false;
    var alpha = 1 - t;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Outer glow
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = b.width + 6;
    strokePath(b.points);
    // Mid
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = b.width + 2;
    strokePath(b.points);
    // Core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, b.width - 0.5);
    strokePath(b.points);
    return true;
  }

  function drawSpark(s, now, dt) {
    var age = now - s.born;
    if (age >= s.life) return false;
    var t = age / s.life;
    s.x += s.vx * (dt / 1000);
    s.y += s.vy * (dt / 1000);
    s.vx *= 0.94;
    s.vy = s.vy * 0.94 + 280 * (dt / 1000);
    ctx.globalAlpha = 1 - t;
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
    var e = Math.min(1, speed / 800);
    var baseR = 36 + e * 30;
    var pulse = Math.sin(now / 130) * 4;
    var r = baseR + pulse;
    ctx.save();
    ctx.globalAlpha = 0.35 + e * 0.45;
    ctx.strokeStyle = e > 0.4 ? '#ffff66' : '#00d4ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 20;
    ctx.lineWidth = 1.5 + e * 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Adaptive quality ----------
  function updateFps(now) {
    if (fpsLastTs) {
      var dt = now - fpsLastTs;
      if (dt > 0) {
        var inst = 1000 / dt;
        fpsAvg = fpsAvg * 0.92 + inst * 0.08;
      }
    }
    fpsLastTs = now;
    if (fpsAvg < LOW_FPS_THRESHOLD && qualityScale > 0.5) qualityScale -= 0.02;
    else if (fpsAvg > 55 && qualityScale < 1.0) qualityScale += 0.01;
    // Expose for HUD
    if (!window.PerfStats) window.PerfStats = {};
    window.PerfStats.fps = Math.round(fpsAvg);
    window.PerfStats.quality = qualityScale;
  }

  // ---------- Main loop ----------
  function loop() {
    if (document.hidden) { rafId = 0; return; }
    var now = performance.now();
    updateFps(now);

    var dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;

    var hands = window.GestureHands || [];

    // Idle detection — sleep when nothing is happening
    var anyFastHand = false;
    for (var i = 0; i < hands.length; i++) {
      if (hands[i] && hands[i].velocity && hands[i].velocity.speed > IDLE_SPEED) { anyFastHand = true; break; }
    }
    var hasFX = bolts.length || sparks.length || shockwaves.length || energyBalls.length || cursor.visible;
    if (anyFastHand || hands.length >= 2 || hasFX) {
      lastActive = now;
      asleep = false;
    } else if (now - lastActive > IDLE_SLEEP_MS) {
      asleep = true;
    }

    // Even when asleep, fully clear once then schedule the next check less aggressively
    if (asleep) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      // poll less often when asleep
      setTimeout(function () {
        rafId = requestAnimationFrame(loop);
      }, 80);
      return;
    }

    // Trailing fade
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * qualityScale + 0.1) + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';

    // Per-hand FX
    for (var h = 0; h < hands.length; h++) {
      var hand = hands[h];
      if (!hand || !hand.landmarks) continue;
      drawEnergyRing(hand, now);
      maybeSoloBolts(hand);
    }

    if (hands.length >= 2) dualHandLightning(hands[0], hands[1]);

    detectForcePush();
    updateCursor(now);
    updateEnergyBalls(now);

    // Draw shockwaves
    var liveSw = [];
    for (var s = 0; s < shockwaves.length; s++) {
      if (drawShockwave(shockwaves[s], now)) liveSw.push(shockwaves[s]);
    }
    shockwaves = liveSw;

    // Draw energy balls
    for (var eb = 0; eb < energyBalls.length; eb++) drawEnergyBall(energyBalls[eb], now);

    // Draw bolts
    var liveBolts = [];
    for (var b = 0; b < bolts.length; b++) {
      if (drawBolt(bolts[b], now)) liveBolts.push(bolts[b]);
    }
    bolts = liveBolts;

    // Draw sparks
    var liveSparks = [];
    for (var sp = 0; sp < sparks.length; sp++) {
      if (drawSpark(sparks[sp], now, dt)) liveSparks.push(sparks[sp]);
    }
    sparks = liveSparks;

    // Cursor on top
    drawCursor(now);

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
      console.log('⚡ Lightning FX v2 online — adaptive, cursor + shockwave + energy ball');
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
  window.LightningFX = {
    bolt: function (ax, ay, bx, by, opts) { ensureCanvas(); pushBolt(makeBolt(ax, ay, bx, by, opts)); },
    sparks: function (x, y, n, color) { ensureCanvas(); makeSparkBurst(x, y, n || 12, color); },
    shockwave: function (x, y, intensity) { ensureCanvas(); spawnShockwave(x, y, intensity); },
    cursorPos: function () { return cursor.visible ? { x: cursor.x, y: cursor.y } : null; }
  };
})();
