/*
 * The taskbar search box in "web" mode (see switch.js).
 *
 * Opens what was typed in a SuperNova Browser window, so the desktop stays put
 * while a page loads. URL detection, search engine choice, safe search and the
 * content filter are all handled by the Browser app through SnProxy.open().
 *
 * While you type, suggestions rise above the box (the server asks the search engine, see
 * src/suggest.js). Up and Down pick one, Enter opens it, Escape closes them.
 */
(function () {
  var form = document.getElementById('fs');
  var input = document.getElementById('is');
  var box = document.getElementById('suggest');
  if (!form || !input) return;

  var items = [], active = -1, timer = 0, seq = 0, shown = false, hideTimer = 0;

  function engine() {
    try { return window.SnProxy ? window.SnProxy.get('search') : 'brave'; } catch (e) { return 'brave'; }
  }

  function icon(kind) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', kind === 'go' ? 'M4 12h14M13 6l6 6-6 6' : 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21');
    svg.appendChild(path);
    return svg;
  }

  function hide() {
    clearTimeout(timer);
    seq++;
    if (!box || !shown) return;
    shown = false;
    items = []; active = -1;
    var a = box.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 120, easing: 'ease-in' });
    a.onfinish = function () { if (!shown) box.style.display = 'none'; };
  }

  function select(index) {
    active = index;
    var rows = box.children;
    for (var i = 0; i < rows.length; i++) rows[i].setAttribute('aria-selected', String(i === index));
  }

  function choose(index) {
    if (!items[index]) return;
    input.value = items[index].value;
    hide();
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function render(typed, list) {
    items = [];
    var url = null;
    try { url = window.SnResolve && window.SnResolve.toUrl(typed); } catch (e) { url = null; }
    if (url) {
      var host = new URL(url).hostname.replace(/^www\./, '');
      items.push({ value: typed, text: 'Open ' + host, kind: 'go' });
    }
    list.forEach(function (text) { items.push({ value: text, text: text, kind: 'search' }); });
    if (!items.length) { hide(); return; }

    var first = !shown;
    box.textContent = '';
    var lower = typed.toLowerCase();
    items.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'sg-item' + (item.kind === 'go' ? ' sg-go' : '');
      row.setAttribute('role', 'option');
      row.appendChild(icon(item.kind));
      var text = document.createElement('span');
      if (item.kind === 'search' && item.text.toLowerCase().indexOf(lower) === 0) {
        text.appendChild(document.createTextNode(item.text.slice(0, typed.length)));
        var rest = document.createElement('b');
        rest.textContent = item.text.slice(typed.length);
        text.appendChild(rest);
      } else {
        text.textContent = item.text;
      }
      row.appendChild(text);
      row.addEventListener('mousedown', function (event) { event.preventDefault(); choose(i); });
      row.addEventListener('mousemove', function () { if (active !== i) select(i); });
      box.appendChild(row);
      if (first) row.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, delay: 40 + (items.length - 1 - i) * 24, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
    });
    active = -1;

    var rect = input.getBoundingClientRect();
    var button = document.getElementById('switch');
    var width = (button ? button.getBoundingClientRect().right : rect.right) - rect.left;
    box.style.left = rect.left + 'px';
    box.style.width = width + 'px';
    box.style.bottom = (window.innerHeight - rect.top) + 'px';
    box.style.display = 'block';
    shown = true;
    if (first) box.animate([{ opacity: 0, transform: 'translateY(16px) scaleY(0.9)' }, { opacity: 1, transform: 'translateY(0) scaleY(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  function ask() {
    var typed = input.value.replace(/\s+/g, ' ').trim();
    if (typed.length < 2) { hide(); return; }
    var mine = ++seq;
    fetch('/api/suggest?q=' + encodeURIComponent(typed) + '&engine=' + encodeURIComponent(engine()), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : { suggestions: [] }; })
      .catch(function () { return { suggestions: [] }; })
      .then(function (data) {
        if (mine !== seq || input.value.replace(/\s+/g, ' ').trim() !== typed) return; // an older answer
        render(typed, Array.isArray(data.suggestions) ? data.suggestions : []);
      });
  }

  if (box) {
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(ask, 130); });
    input.addEventListener('focus', function () { if (input.value.trim().length >= 2) ask(); });
    input.addEventListener('blur', function () { hideTimer = setTimeout(hide, 120); });
    input.addEventListener('keydown', function (event) {
      if (!shown) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); select((active + 1) % items.length); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); select(active <= 0 ? items.length - 1 : active - 1); }
      else if (event.key === 'Escape') { event.preventDefault(); hide(); }
    });
    window.SnSuggest = { hide: hide };
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (shown && active >= 0 && items[active]) input.value = items[active].value;
    var query = input.value.trim();
    clearTimeout(hideTimer);
    hide();
    if (!query) return;
    input.value = '';
    hideSearch();
    addWindow(0, null, query, DEF_WIN_W, DEF_WIN_H);
  });
})();
