const form = document.getElementById('fs')
const input = document.getElementById('is')

if (form && input) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    processUrl(input.value)
  })
}

function processUrl(value, path) {
  const target = SnResolve.resolve(value, SnProxy.get('search'));
  if (!target) return;
  const url = target.url;

  const restrictedWebsites = new Set([
    "pornhub.com", "8tube.xxx", "redtube.com", "kink.com",
    "youjizz.com", "xvideos.com", "youporn.com",
    "brazzers.com", "fuck.com"
  ]);

  const restrictedKeywords = [
    "porn", "xxx", "adult", "sex", "nude", "erotic", "fetish"
  ];

  const normalizedUrl = new URL(url).hostname.replace(/^www\./, '').toLowerCase();

  const isRestrictedWebsite = Array.from(restrictedWebsites).some(restricted =>
    normalizedUrl === restricted || normalizedUrl.endsWith(`.${restricted}`)
  );

  const isRestrictedKeyword = restrictedKeywords.some(keyword =>
    url.toLowerCase().includes(keyword)
  );

  if (isRestrictedWebsite || isRestrictedKeyword) {
    document.write("This query is restricted by SuperNova. Please try another query.");
    return;
  }

  // Wait for the service worker to be *active* and the transport connected, not
  // just registered. Navigating earlier hits the server and shows a 404.
  SnProxy.go(url).then((proxied) => {
    window.location.href = path || proxied;
  }, (err) => {
    if (typeof openPopup === 'function') openPopup('Proxy error', err.message);
    else alert(err.message);
  });
}

function go(value) {
  processUrl(value, false)
}

function now(value) {
  processUrl(value, '/e')
}

function blank(value) {
  processUrl(value)
}
