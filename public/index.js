const form = document.getElementById('fs')
const input = document.getElementById('is')

if (form && input) {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    processUrl(input.value)
  })
}

// Resolve the typed text (URL or search), check it against the content filter,
// wait for the proxy to be ready, then navigate to the proxied address.
function processUrl(value) {
  SnProxy.open(value).then((proxied) => {
    if (proxied) window.location.href = proxied
  }, (err) => {
    const title = err.blocked ? 'Blocked by SuperNova' : 'Proxy error'
    if (typeof openPopup === 'function') openPopup(title, escapeHtml(err.message))
    else alert(err.message)
  })
}
