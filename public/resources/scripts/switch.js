/*
 * The taskbar search box has two modes: searching the desktop's apps ("Apps") and
 * searching the web ("Web"), which opens a Browser window (see websearch.js).
 */
document.addEventListener('DOMContentLoaded', function () {
  var button = document.getElementById('switch');
  var appsBox = document.getElementById('search');
  var webForm = document.getElementById('fs');
  if (!button || !appsBox || !webForm) return;

  function setWebMode(web) {
    appsBox.style.display = web ? 'none' : 'block';
    webForm.style.display = web ? 'block' : 'none';
    button.classList.toggle('enabled', web);
    button.setAttribute('aria-pressed', String(web));
    button.textContent = web ? 'Web' : 'Apps';
    if (web) document.getElementById('is').focus();
  }

  button.addEventListener('click', function () {
    setWebMode(!button.classList.contains('enabled'));
  });
});
