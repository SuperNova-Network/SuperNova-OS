/*
 * The taskbar search box in "web" mode (see switch.js).
 *
 * Opens what was typed in a SuperNova Browser window, so the desktop stays put
 * while a page loads. URL detection, search engine choice, safe search and the
 * content filter are all handled by the Browser app through SnProxy.open().
 */
(function () {
  var form = document.getElementById('fs');
  var input = document.getElementById('is');
  if (!form || !input) return;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) return;
    input.value = '';
    hideSearch();
    addWindow(0, null, query, DEF_WIN_W, DEF_WIN_H);
  });
})();
