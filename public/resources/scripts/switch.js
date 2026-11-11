/*
 * The taskbar search box has two modes: searching the desktop's apps ("Apps") and
 * searching the web ("Web"), which opens a Browser window (see websearch.js).
 *
 * Switching is animated: the old box flips away like a card, the new one flips in, a beam of light runs
 * across it from the button with sparks trailing behind, the button squashes and its label rolls over,
 * and the new placeholder is typed out. Someone who asks their system for less motion gets an instant swap.
 */
document.addEventListener('DOMContentLoaded', function () {
  var button = document.getElementById('switch');
  var appsBox = document.getElementById('search');
  var webForm = document.getElementById('fs');
  var webBox = document.getElementById('is');
  if (!button || !appsBox || !webForm || !webBox) return;

  var PLACEHOLDER = { apps: 'Search in SnOS', web: 'Search the web freely' };
  button.textContent = '';
  var label = document.createElement('span');
  label.className = 'switch-label';
  label.textContent = 'Apps';
  button.appendChild(label);

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var token = 0, running = [], fx = null, typing = 0, mode = false; // mode: the one most recently asked for

  // The state, instantly: which box shows, what the button says.
  function setWebMode(web) {
    appsBox.style.display = web ? 'none' : 'block';
    webForm.style.display = web ? 'block' : 'none';
    button.classList.toggle('enabled', web);
    button.setAttribute('aria-pressed', String(web));
    label.textContent = web ? 'Web' : 'Apps';
    webBox.classList.toggle('web-on', web);
    if (!web && window.SnSuggest) window.SnSuggest.hide();
    if (web) webBox.focus();
  }

  function stopEverything() {
    running.forEach(function (a) { try { a.cancel(); } catch (e) { /* done already */ } });
    running = [];
    clearInterval(typing);
    if (fx) { fx.remove(); fx = null; }
  }

  function play(el, frames, options) {
    var a = el.animate(frames, options);
    running.push(a);
    return a;
  }

  function accent() {
    var c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return c || '#8b5cf6';
  }

  // Type a placeholder out letter by letter.
  function typePlaceholder(box, text) {
    clearInterval(typing);
    var i = 0;
    box.placeholder = '';
    typing = setInterval(function () {
      i++;
      box.placeholder = text.slice(0, i);
      if (i >= text.length) clearInterval(typing);
    }, 28);
  }

  // The light, the glow line and the sparks that run across the new box, starting at the button.
  function burst(target, toWeb) {
    var rect = target.getBoundingClientRect();
    var from = button.getBoundingClientRect();
    var color = toWeb ? '#5cc8ff' : accent();
    fx = document.createElement('div');
    fx.className = 'searchfx';
    fx.style.cssText = 'left:' + rect.left + 'px;top:' + (rect.top - 30) + 'px;width:' + (from.right - rect.left) + 'px;height:' + (rect.height + 60) + 'px;';
    var field = document.createElement('div');
    field.style.cssText = 'position:absolute;left:0;top:30px;width:' + rect.width + 'px;height:' + rect.height + 'px;overflow:hidden;';
    var beam = document.createElement('div');
    beam.style.cssText = 'position:absolute;top:0;bottom:0;width:45%;right:0;background:linear-gradient(100deg,transparent 0%,' + color + '44 30%,' + color + 'cc 50%,' + color + '44 70%,transparent 100%);';
    var line = document.createElement('div');
    line.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;background:' + color + ';box-shadow:0 0 14px 2px ' + color + ';transform-origin:100% 50%;';
    field.appendChild(beam);
    field.appendChild(line);
    fx.appendChild(field);
    // sparks: from the button's middle, fanning out leftwards over the box
    var originX = from.left + from.width / 2 - rect.left, originY = 30 + rect.height / 2;
    var sparks = [];
    for (var i = 0; i < 18; i++) {
      var s = document.createElement('i');
      var size = 2 + Math.random() * 3;
      s.style.cssText = 'position:absolute;left:' + originX + 'px;top:' + originY + 'px;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + (i % 3 ? '#fff' : color) + ';box-shadow:0 0 6px ' + color + ';';
      fx.appendChild(s);
      sparks.push(s);
    }
    document.body.appendChild(fx);
    var mineFx = fx;
    setTimeout(function () { mineFx.remove(); if (fx === mineFx) fx = null; }, 1500);

    play(beam, [{ transform: 'translateX(40%)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'translateX(-260%)', opacity: 0.9, offset: 0.85 }, { transform: 'translateX(-300%)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.3,.6,.3,1)' });
    play(line, [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.55 }, { transform: 'scaleX(1)', opacity: 0 }], { duration: 760, easing: 'cubic-bezier(.2,.8,.2,1)' });
    sparks.forEach(function (s, i) {
      var dx = -(30 + Math.random() * (rect.width * 0.85)), dy = (Math.random() - 0.5) * (rect.height + 40);
      play(s, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.2)', opacity: 0 }], { duration: 420 + Math.random() * 380, delay: i * 14, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    });
  }

  function animateSwitch(toWeb) {
    var mine = ++token;
    stopEverything();
    var outgoing = toWeb ? appsBox : webBox;
    var incoming = toWeb ? webBox : appsBox;

    // the button: a squash and a bounce, and the label rolls up while the new one rolls in from below
    play(button, [{ transform: 'scale(1)' }, { transform: 'scale(0.78)', offset: 0.25 }, { transform: 'scale(1.14)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' });
    play(label, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-90%)', opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = function () {
      if (mine !== token) return;
      label.textContent = toWeb ? 'Web' : 'Apps';
      play(label, [{ transform: 'translateY(90%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,1.2,.4,1)', fill: 'forwards' });
    };

    // the old box flips away ...
    var flipOut = play(outgoing, [
      { transform: 'perspective(700px) rotateX(0deg) scale(1)', opacity: 1, filter: 'blur(0)' },
      { transform: 'perspective(700px) rotateX(' + (toWeb ? -88 : 88) + 'deg) scale(0.96)', opacity: 0.2, filter: 'blur(2px)' },
    ], { duration: 220, easing: 'cubic-bezier(.55,0,.9,.6)', fill: 'forwards' });
    flipOut.onfinish = function () {
      if (mine !== token) return;
      outgoing.getAnimations().forEach(function (a) { a.cancel(); });
      // ... and the new one flips in
      button.classList.toggle('enabled', toWeb);
      button.setAttribute('aria-pressed', String(toWeb));
      appsBox.style.display = toWeb ? 'none' : 'block';
      webForm.style.display = toWeb ? 'block' : 'none';
      webBox.classList.toggle('web-on', toWeb);
      play(incoming, [
        { transform: 'perspective(700px) rotateX(' + (toWeb ? 88 : -88) + 'deg) scale(0.96)', opacity: 0.2, filter: 'blur(2px)' },
        { transform: 'perspective(700px) rotateX(0deg) scale(1)', opacity: 1, filter: 'blur(0)' },
      ], { duration: 420, easing: 'cubic-bezier(.2,1.25,.35,1)' });
      burst(incoming, toWeb);
      typePlaceholder(toWeb ? webBox : appsBox, toWeb ? PLACEHOLDER.web : PLACEHOLDER.apps);
      if (toWeb) webBox.focus(); else if (window.SnSuggest) window.SnSuggest.hide();
    };
  }

  button.addEventListener('click', function () {
    var toWeb = !mode;
    if (reduced && reduced.matches) { mode = toWeb; setWebMode(toWeb); return; }
    // Clicked again halfway: land at once in the mode that was asked for, then switch back from there.
    running = running.filter(function (a) { return a.playState === 'running' || a.playState === 'pending'; });
    if (running.length) { stopEverything(); setWebMode(mode); }
    mode = toWeb;
    animateSwitch(toWeb);
  });
});
