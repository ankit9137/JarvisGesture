'use strict';
/* JARVIS Perf HUD + global hotkeys
   - Tiny FPS / quality badge bottom-left
   - Esc = panic pause (stops engine, freezes FX, shows "PAUSED")
   - P   = screenshot (uses PowerFeatures if available)
   - R   = reset stickman hit counter
   - H is owned by dashboard.js (widget toggle), G by gesture-trainer */
(function () {
  var badge = null;
  var pauseOverlay = null;
  var lastFpsShow = 0;
  var paused = false;

  function ensureBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.id = 'perf-hud';
    badge.style.cssText = 'position:fixed;bottom:50px;left:14px;z-index:9996;'
      + 'background:rgba(0,20,35,0.85);border:1px solid rgba(0,212,255,0.6);'
      + 'color:#00d4ff;font-family:"Courier New",monospace;font-size:10px;'
      + 'padding:4px 8px;letter-spacing:1.5px;box-shadow:0 0 8px rgba(0,212,255,0.3);'
      + 'pointer-events:none;min-width:120px;';
    badge.textContent = 'FPS: -- Q: --';
    document.body.appendChild(badge);
  }

  function ensurePauseOverlay() {
    if (pauseOverlay) return;
    pauseOverlay = document.createElement('div');
    pauseOverlay.id = 'panic-pause';
    pauseOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);'
      + 'z-index:99999;display:none;align-items:center;justify-content:center;'
      + 'color:#ff5566;font-family:"Courier New",monospace;font-size:48px;'
      + 'letter-spacing:8px;text-shadow:0 0 24px #ff5566;pointer-events:none;';
    pauseOverlay.textContent = '⏸ PAUSED — PRESS ESC TO RESUME';
    document.body.appendChild(pauseOverlay);
  }

  function tickFps() {
    var now = performance.now();
    if (now - lastFpsShow > 350) {
      var s = window.PerfStats || {};
      var fps = s.fps != null ? s.fps : '--';
      var q = s.quality != null ? Math.round(s.quality * 100) + '%' : '--';
      var hits = (window.Stickman && window.Stickman.hits) ? window.Stickman.hits() : 0;
      badge.textContent = 'FPS: ' + fps + '  Q: ' + q + '  HITS: ' + hits;
      // Color cue
      if (typeof s.fps === 'number') {
        if (s.fps < 30) badge.style.color = '#ff5566';
        else if (s.fps < 45) badge.style.color = '#ffe066';
        else badge.style.color = '#00ff88';
      }
      lastFpsShow = now;
    }
    requestAnimationFrame(tickFps);
  }

  function togglePause() {
    paused = !paused;
    if (window.GestureState) window.GestureState.paused = paused;
    if (pauseOverlay) pauseOverlay.style.display = paused ? 'flex' : 'none';
    if (window.JarvisBrain && window.JarvisBrain.say) {
      window.JarvisBrain.say(paused ? '⏸ Paused' : '▶ Resumed');
    }
  }

  function screenshot() {
    if (window.PowerFeatures && window.PowerFeatures.screenshot) {
      window.PowerFeatures.screenshot();
    } else if (window.JarvisBrain && window.JarvisBrain.say) {
      window.JarvisBrain.say('Screenshot unavailable');
    }
  }

  function resetStickman() {
    if (window.Stickman && window.Stickman.reset) {
      window.Stickman.reset();
      if (window.JarvisBrain && window.JarvisBrain.say) {
        window.JarvisBrain.say('🚶 Stickman respawned');
      }
    }
  }

  function onKey(e) {
    // Ignore keys when typing in an input
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (k === 'p' || k === 'P') { e.preventDefault(); screenshot(); return; }
    if (k === 'r' || k === 'R') { e.preventDefault(); resetStickman(); return; }
  }

  function init() {
    ensureBadge();
    ensurePauseOverlay();
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(tickFps);
    if (typeof console !== 'undefined' && console.log) {
      console.log('📊 Perf HUD ready — Esc pause, P screenshot, R reset stickman, H widgets');
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
