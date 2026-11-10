# Cloaking

Everything here is in **Settings > Cloaking** and applies live, including across open windows.

## Tab disguise

Changes the **title and icon** of the browser tab to look like another site. Thirteen presets are built in (Google Classroom, Docs, Drive and Slides, Canvas, Schoology, Clever, Khan Academy, Desmos, IXL, Quizlet, Wikipedia, Google) plus a **Custom** option with your own title and icon.

- It is applied **every time the site loads**, and again whenever you change it.
- A custom icon must be an `https://` address or a path on this site. `javascript:`, `data:` and similar addresses are refused.
- The default disguise is Google Classroom. The page's HTML already carries that title and icon, so the real logo never flashes before the script runs.
- Preset icons come from Google's favicon service, because sites' own icon URLs change with every deploy.

## Open in a cloaked tab

Runs SuperNova inside a full-size frame in a new tab that carries the disguise, then **sends the original tab to your panic destination**.

- **about:blank** opens `about:blank` and writes the page into it.
- **blob:** does the same through a `blob:` URL, which some filters treat differently.
- **Open cloaked automatically** makes the *first click of each visit* open the cloaked tab. A click is required because browsers block pop-ups that are not caused by one. Add `?nocloak=1` to the address to skip it once (the cloaked copy itself uses `?cloaked=1` so it does not try again).

If nothing happens, the browser blocked the pop-up: allow pop-ups for the site and try again. We tested this in Chromium-based browsers.

## Panic key

One key combination that immediately sends the tab to your **panic destination** (a preset such as Google Classroom, or any `http(s)` address).

- Click the shortcut button, then press the combination. **Esc** cancels. It must include **Ctrl, Alt or Cmd**; a bare letter would trigger while you type, so it is refused.
- Combinations are stored by physical key (`event.code`), so they survive keyboard layout changes.
- It works while focus is in the desktop, in any desktop window, in Browser tabs, and inside proxied pages, which are same-origin frames.
- Inside a cloaked `about:blank` tab it replaces *that* tab.
- It does **not** work inside cross-origin embeds, such as the bundled games hosted on `picturelements.github.io`; the browser does not let the desktop see keys pressed there.
- **Try it now** tests the destination without using the keys.

## Confirm before closing

Asks for confirmation if the tab is closed or reloaded. The browser decides the wording, and requires you to have interacted with the page first.

## What cloaking does *not* do

Cloaking changes how a **tab looks** and where it can be sent quickly. It does not hide anything from the network:

- Whoever runs the network can still see that your device is talking to **this site's address**, even though the pages inside are proxied.
- Software installed on the device (monitoring extensions, screen capture, management agents) can see the real page contents regardless of the tab title.
- The browser's history and the address bar show this site, not the title you chose.

Treat it as a convenience, not as protection.
