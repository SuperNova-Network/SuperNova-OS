/*
 * The taskbar search box has two modes: searching the desktop's apps ("Apps") and
 * searching the web ("Web"), which opens a Browser window (see websearch.js).
 *
 * Switching is animated: the old box flips away like a card and the new one flips in, the button's label
 * rolls up and the next one rolls in, and the new placeholder is typed out. Someone who asks their system for
 * less motion gets an instant swap.
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
  var token = 0, running = [], typing = 0, mode = false; // mode: the one most recently asked for

  // The state, instantly: which box shows, what the button says.
  function setWebMode(web) {
    appsBox.style.display = web ? 'none' : 'block';
    webForm.style.display = web ? 'block' : 'none';
    button.classList.toggle('enabled', web);
    button.setAttribute('aria-pressed', String(web));
    label.textContent = web ? 'Web' : 'Apps';
    if (!web && window.SnSuggest) window.SnSuggest.hide();
    if (web) webBox.focus();
  }

  function stopEverything() {
    running.forEach(function (a) { try { a.cancel(); } catch (e) { /* done already */ } });
    running = [];
    clearInterval(typing);
  }

  function play(el, frames, options) {
    var a = el.animate(frames, options);
    running.push(a);
    return a;
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

  function animateSwitch(toWeb) {
    var mine = ++token;
    stopEverything();
    var outgoing = toWeb ? appsBox : webBox;
    var incoming = toWeb ? webBox : appsBox;

    // the button's label rolls up while the new one rolls in from below
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
      play(incoming, [
        { transform: 'perspective(700px) rotateX(' + (toWeb ? 88 : -88) + 'deg) scale(0.96)', opacity: 0.2, filter: 'blur(2px)' },
        { transform: 'perspective(700px) rotateX(0deg) scale(1)', opacity: 1, filter: 'blur(0)' },
      ], { duration: 420, easing: 'cubic-bezier(.2,1.25,.35,1)' });
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
