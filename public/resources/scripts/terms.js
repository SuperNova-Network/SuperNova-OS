/*
 * The acceptable use screen. When an admin turns it on (Admin Panel > Site), anyone who is not signed in sees a
 * full-screen legal notice in the desktop's own dark look and accent colour (with the warning itself in red), like a terms of service, saying this site is only an education and open source
 * learning project and must not be used during school or to get past school filters. They have to tick that they
 * have read it and press "I agree" once; that is remembered on this device, even after the site is closed, and
 * they are not asked again. People who are signed in are never shown it. It is checked again live when an admin
 * turns it on or off (see siteinfo.js).
 *
 * Plain script; works on the desktop and on the sign-in page. The text is put on the page with textContent.
 */
(function (global) {
  "use strict";

  var KEY = "snTermsAgreed"; // its own key: it is not synced with an account and survives signing out
  var LOGO = "/resources/media/app_icons/SuperNova.png";
  var enabled = null, signedIn = null, current = null;

  function agreed() { try { return global.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function remember() { try { global.localStorage.setItem(KEY, "1"); } catch (e) { /* private mode: asked again next time */ } }

  var SECTIONS = [
    ["1. Purpose of this website", "SuperNova OS (the “Website”) was created solely for education and for learning about open source software development, web technologies and programming. It is an open source learning project, shared so that people can study how it works, change it and build on it."],
    ["2. Prohibited use", "You must NOT use the Website (a) during school hours, class time or any lesson; (b) on a school-owned device or a school network; (c) to bypass, evade, circumvent, disable or defeat any content filter, firewall, monitoring tool or other security measure set up by a school, school district, employer, parent or guardian, or network administrator; (d) to open anything that is blocked or restricted for you; or (e) in any way that breaks a school code of conduct, an acceptable use policy, or the law."],
    ["3. Your responsibility", "You alone are responsible for how you use the Website and for every result of that use, including any discipline, loss of access or other consequence imposed by your school, your parents or guardians, your employer or anyone else. Not knowing the rules is not an excuse."],
    ["4. No encouragement or endorsement", "The creators, contributors and operators of the Website do not encourage, authorize, approve or condone any use that goes against Section 2, and accept no responsibility for it. Nothing on the Website is an invitation to break any rule."],
    ["5. No warranty and limit of liability", "The Website is provided “as is”, without warranty of any kind, express or implied. To the fullest extent the law allows, the creators, contributors and operators are not liable for any claim, damage, loss or consequence arising from the use of the Website or from your agreement to these terms."],
    ["6. Open source", "The source code of the Website is published under an open source licence so that anyone can read and learn from it. The licence covers the code. It does not give anyone permission to use the Website in a way these terms forbid."],
    ["7. Your agreement", "By ticking the box and pressing “I AGREE”, you confirm that you have read and understood this notice, that you will not use the Website in any way described in Section 2, and that you accept these terms. If you do not agree, you must leave the Website now. Your agreement is saved on this device so that you are not asked again."],
  ];

  // Everything is sized in one unit, --u, so the screen looks the same on any window shape and always fits it:
  // about 100u tall on a wide screen. Nothing scrolls on the page; the text is shrunk (see fit) until it fits.
  // It is laid out like one of the desktop's own windows (an accent title bar, flat dark panels, a button row
  // at the bottom) on a dark backdrop. The only red is the warning.
  function css() {
    return '\
#sn-terms{--u:min(1vh,.6vw);--a:var(--accent,#7b4aa8);position:fixed;inset:0;z-index:2147483000;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 20% 10%,color-mix(in srgb,var(--a) 22%,#0d0d12) 0%,transparent 60%),radial-gradient(ellipse at 90% 100%,color-mix(in srgb,var(--a) 14%,#0d0d12) 0%,transparent 55%),#0d0d12;color:#e6e6e6;font-family:"Segoe UI","Segoe UI Variable",Selawik,system-ui,-apple-system,Roboto,sans-serif;-webkit-font-smoothing:antialiased}\
@media (max-aspect-ratio:1/1){#sn-terms{--u:min(1vh,1.7vw)}}\
#sn-terms *{box-sizing:border-box;cursor:default}\
#sn-terms .st-win{display:flex;flex-direction:column;width:min(96vw,calc(var(--u)*148));height:min(94vh,calc(var(--u)*88));background:#1f1f1f;box-shadow:0 calc(var(--u)*2.4) calc(var(--u)*7) rgba(0,0,0,.65),0 0 0 1px #3a3a3a;animation:st-rise 480ms cubic-bezier(.1,.9,.2,1) both}\
@keyframes st-rise{from{opacity:0;transform:translateY(calc(var(--u)*1.6)) scale(.985)}}\
#sn-terms .st-titlebar{flex:none;display:flex;align-items:center;gap:calc(var(--u)*1.1);height:calc(var(--u)*4.2);padding:0 calc(var(--u)*1.6);background:var(--a);font-size:calc(var(--u)*1.6);color:#fff}\
#sn-terms .st-titlebar img{width:calc(var(--u)*2.4);height:calc(var(--u)*2.4)}\
#sn-terms .st-main{flex:1;min-height:0;display:flex}\
#sn-terms .st-side{flex:none;width:calc(var(--u)*40);display:flex;flex-direction:column;padding:calc(var(--u)*3) calc(var(--u)*2.8);background:#2b2b2b}\
#sn-terms .st-logo{width:calc(var(--u)*8);height:calc(var(--u)*8);display:block;margin:0 0 calc(var(--u)*2)}\
#sn-terms h1{margin:0 0 calc(var(--u)*1);font-size:calc(var(--u)*3.7);line-height:1.08;font-weight:300;color:#fff}\
#sn-terms .st-sub{margin:0 0 calc(var(--u)*2);font-size:calc(var(--u)*1.75);line-height:1.4;color:#c6c6c6}\
#sn-terms .st-sub b{color:#fff;font-weight:700}\
#sn-terms .st-lead{margin:0;padding:calc(var(--u)*1.2) calc(var(--u)*1.5);background:rgba(229,72,77,.14);border-left:calc(var(--u)*.4) solid #e5484d;font-size:calc(var(--u)*1.45);font-weight:600;line-height:1.45;color:#ffd5d7}\
#sn-terms .st-meta{margin:auto 0 0;padding-top:calc(var(--u)*2);font:600 calc(var(--u)*1.05)/1.6 "Consolas","Courier New",monospace;letter-spacing:.08em;text-transform:uppercase;color:#8c8c8c}\
#sn-terms .st-body{flex:1;min-width:0;min-height:0;overflow:hidden;padding:calc(var(--u)*2.6) calc(var(--u)*3.2);font-size:calc(var(--u)*1.55);line-height:1.5;color:#cfcfcf}\
#sn-terms h2{margin:calc(var(--u)*1.5) 0 calc(var(--u)*.3);font-size:1em;font-weight:700;color:#fff}\
#sn-terms h2:first-child{margin-top:0}\
#sn-terms h2 span{display:inline-block;min-width:1.7em;color:color-mix(in srgb,var(--a) 55%,#fff)}\
#sn-terms .st-body p{margin:0 0 calc(var(--u)*.3) 0;padding-left:1.7em}#sn-terms .st-side p{margin-top:0}\
#sn-terms .st-foot{flex:none;display:flex;align-items:center;gap:calc(var(--u)*2.4);padding:calc(var(--u)*1.6) calc(var(--u)*2.8);background:#2b2b2b;border-top:1px solid #3a3a3a}\
#sn-terms label{flex:1;display:flex;gap:calc(var(--u)*1.2);align-items:flex-start;font-size:calc(var(--u)*1.45);line-height:1.4;color:#f0f0f0;cursor:pointer!important}\
#sn-terms label *{cursor:pointer!important}\
#sn-terms input[type=checkbox]{flex:none;width:calc(var(--u)*2.1);height:calc(var(--u)*2.1);margin:0;accent-color:var(--a)}\
#sn-terms .st-buttons{flex:none;display:flex;gap:calc(var(--u)*1)}\
#sn-terms button{min-width:calc(var(--u)*17);padding:calc(var(--u)*.9) calc(var(--u)*2);border:2px solid transparent;border-radius:0;background:#3b3b3b;color:#fff;font:400 calc(var(--u)*1.55) "Segoe UI","Segoe UI Variable",Selawik,system-ui,sans-serif;transition:background-color 100ms,border-color 100ms}\
#sn-terms button:hover{background:#444;border-color:#6b6b6b}\
#sn-terms button.agree{background:var(--a)}\
#sn-terms button.agree:not(:disabled):hover{border-color:#fff}\
#sn-terms button:disabled{opacity:.4;pointer-events:none}\
#sn-terms .st-preview{position:absolute;top:calc(var(--u)*1.4);left:50%;transform:translateX(-50%);padding:calc(var(--u)*.4) calc(var(--u)*1.2);background:#fff;color:#111;font:700 calc(var(--u)*1.2) "Segoe UI",sans-serif;letter-spacing:.14em;z-index:2}\
@media (max-aspect-ratio:1/1){#sn-terms .st-main{flex-direction:column}#sn-terms .st-side{width:auto;padding:calc(var(--u)*1.4) calc(var(--u)*2)}#sn-terms .st-logo,#sn-terms .st-meta{display:none}#sn-terms h1{font-size:calc(var(--u)*3)}#sn-terms .st-foot{flex-direction:column;align-items:stretch;gap:calc(var(--u)*1.2)}#sn-terms .st-buttons{justify-content:flex-end}}\
@media (prefers-reduced-motion:reduce){#sn-terms .st-win{animation:none}#sn-terms button{transition:none}}';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The page never scrolls: shrink the text until all of it fits its box. (If a window is so small that it can't
  // fit even at a small size, the text box scrolls on its own so nothing is lost.)
  function fit() {
    var body = current && current.querySelector(".st-body");
    if (!body) return;
    body.style.fontSize = "";
    body.style.overflowY = "hidden";
    var size = parseFloat(global.getComputedStyle(body).fontSize);
    var guard = 0;
    var over = function () { return body.scrollHeight > body.clientHeight + 1; };
    while (over() && size > 9 && guard++ < 80) {
      size *= 0.97;
      body.style.fontSize = size + "px";
    }
    if (over()) body.style.overflowY = "auto";
  }
  var resizeTimer = 0;
  global.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 80); });

  function hide() {
    if (current) { current.remove(); current = null; }
  }

  /** Show the screen. With { preview: true } it records nothing and can be closed (for admins trying it out). */
  function show(options) {
    var preview = Boolean(options && options.preview);
    if (current) return;
    var root = el("div");
    root.id = "sn-terms";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Acceptable use agreement");
    var style = el("style");
    style.textContent = css();
    root.appendChild(style);
    if (preview) root.appendChild(el("div", "st-preview", "PREVIEW: NOTHING IS SAVED"));

    var win = el("div", "st-win");
    var bar = el("div", "st-titlebar");
    var small = el("img");
    small.src = LOGO; small.alt = "";
    bar.appendChild(small);
    bar.appendChild(el("span", "", "SuperNova OS · Acceptable use agreement"));
    win.appendChild(bar);

    var main = el("div", "st-main");
    var side = el("div", "st-side");
    var logo = el("img", "st-logo");
    logo.src = LOGO; logo.alt = "SuperNova OS";
    side.appendChild(logo);
    side.appendChild(el("h1", "", "Before you continue"));
    var sub = el("p", "st-sub");
    sub.appendChild(document.createTextNode("This website must "));
    sub.appendChild(el("b", "", "NOT"));
    sub.appendChild(document.createTextNode(" be used during school or to get past school filters."));
    side.appendChild(sub);
    side.appendChild(el("p", "st-lead", "SuperNova OS was made only for education and for learning open source programming. It is not for use during school, and it is not for getting around school filters or any other restriction."));
    side.appendChild(el("div", "st-meta", "Ref. SN-EDU-AUA · Version 1.0"));
    main.appendChild(side);

    var body = el("div", "st-body");
    body.tabIndex = 0;
    SECTIONS.forEach(function (s) {
      var title = el("h2");
      var number = s[0].match(/^(\d+)\.\s*(.*)$/);
      title.appendChild(el("span", "", number ? number[1] + "." : ""));
      title.appendChild(document.createTextNode(number ? number[2] : s[0]));
      body.appendChild(title);
      body.appendChild(el("p", "", s[1]));
    });
    main.appendChild(body);
    win.appendChild(main);

    var foot = el("div", "st-foot");
    var label = el("label");
    var box = el("input");
    box.type = "checkbox";
    label.appendChild(box);
    label.appendChild(el("span", "", "I have read and understood this notice. I will not use this website during school or to get past school filters, and I accept these terms."));
    var buttons = el("div", "st-buttons");
    var leave = el("button", "leave", preview ? "Close preview" : "I do not agree");
    leave.type = "button";
    var agree = el("button", "agree", "I agree");
    agree.type = "button"; agree.disabled = true;
    buttons.appendChild(leave); buttons.appendChild(agree);
    foot.appendChild(label); foot.appendChild(buttons);
    win.appendChild(foot);
    root.appendChild(win);
    document.body.appendChild(root);
    current = root;
    fit();
    if (global.document.fonts && global.document.fonts.ready) global.document.fonts.ready.then(fit);

    box.addEventListener("change", function () { agree.disabled = !box.checked; });
    agree.addEventListener("click", function () { if (!preview) remember(); hide(); });
    leave.addEventListener("click", function () {
      if (preview) { hide(); return; }
      // Leave: back where they came from, or to a blank page.
      if (global.history.length > 1) global.history.back(); else global.location.href = "about:blank";
    });
    box.focus();
  }

  function who() {
    if (signedIn !== null) return Promise.resolve(signedIn);
    if (!global.SnAccount) { signedIn = false; return Promise.resolve(false); }
    return global.SnAccount.status().then(function (state) { signedIn = Boolean(state && state.user); return signedIn; }, function () { signedIn = false; return false; });
  }

  function evaluate() {
    who().then(function (isIn) {
      if (enabled && !isIn && !agreed()) show(); else if (!(current && current.querySelector(".st-preview"))) hide();
    });
  }

  global.SnTerms = {
    /** The admin's setting, from the server or the live channel. */
    apply: function (on) { enabled = Boolean(on); evaluate(); },
    show: show,
    hide: hide,
  };

  fetch("/api/terms", { credentials: "same-origin", cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { if (data) global.SnTerms.apply(data.enabled); })
    .catch(function () { /* offline: nothing to show */ });
})(self);
