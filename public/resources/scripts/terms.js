/*
 * The acceptable use screen. When an admin turns it on (Admin Panel > Site), anyone who is not signed in sees a
 * bright red full-screen notice, like a terms of service, saying this site is only an education and open source
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
  function css() {
    return '\
#sn-terms{--u:min(1vh,.6vw);position:fixed;inset:0;z-index:2147483000;overflow:hidden;display:flex;flex-direction:column;align-items:center;background:radial-gradient(ellipse at 50% 30%,#ff3b30 0%,#e10d0d 45%,#9d0000 100%);color:#111;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;-webkit-font-smoothing:antialiased}\
@media (max-aspect-ratio:1/1){#sn-terms{--u:min(1vh,1.7vw)}}\
#sn-terms *{box-sizing:border-box;cursor:default}\
#sn-terms .st-tape{flex:none;width:100%;height:calc(var(--u)*3);background:repeating-linear-gradient(-45deg,#111 0 calc(var(--u)*2.2),#ffd500 calc(var(--u)*2.2) calc(var(--u)*4.4));background-size:calc(var(--u)*6.22) calc(var(--u)*6.22);animation:st-tape 1.6s linear infinite}\
@keyframes st-tape{to{background-position:calc(var(--u)*6.22) 0}}\
#sn-terms .st-wrap{flex:1;min-height:0;width:min(94vw,calc(var(--u)*150));display:flex;flex-direction:column;padding:calc(var(--u)*1.2) 0;text-align:center;color:#fff;animation:st-rise 600ms cubic-bezier(.2,.9,.3,1) both}\
@keyframes st-rise{from{opacity:0;transform:translateY(calc(var(--u)*2))}}\
#sn-terms .st-top{flex:none}\
#sn-terms .st-logo{width:calc(var(--u)*8.5);height:calc(var(--u)*8.5);display:block;margin:0 auto calc(var(--u)*.8);filter:drop-shadow(0 calc(var(--u)*.5) calc(var(--u)*1.6) rgba(0,0,0,.55))}\
#sn-terms .st-kicker{display:inline-block;padding:calc(var(--u)*.35) calc(var(--u)*1.4);background:#111;color:#ffd500;font-weight:800;letter-spacing:.28em;font-size:calc(var(--u)*1.25)}\
#sn-terms h1{margin:calc(var(--u)*.9) 0 calc(var(--u)*.3);font-size:calc(var(--u)*5);line-height:1.05;font-weight:900;letter-spacing:.02em;text-transform:uppercase;text-shadow:0 calc(var(--u)*.3) 0 rgba(0,0,0,.35)}\
#sn-terms .st-sub{margin:0 auto;max-width:calc(var(--u)*90);font-size:calc(var(--u)*1.9);font-weight:700;line-height:1.3}\
#sn-terms .st-paper{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;margin:calc(var(--u)*1.6) 0 0;text-align:left;background:#fffdf8;border:calc(var(--u)*.35) double #7a0000;box-shadow:0 calc(var(--u)*2) calc(var(--u)*6) rgba(0,0,0,.5),inset 0 0 0 calc(var(--u)*.6) #fffdf8,inset 0 0 0 calc(var(--u)*.7) #d9c9a8;font-family:Georgia,"Times New Roman",serif}\
#sn-terms .st-head{flex:none;display:flex;justify-content:space-between;gap:calc(var(--u)*1.2);padding:calc(var(--u)*1) calc(var(--u)*2.6) calc(var(--u)*.8);border-bottom:calc(var(--u)*.2) solid #111;font:700 calc(var(--u)*1.1)/1.4 "Consolas","Courier New",monospace;letter-spacing:.08em;text-transform:uppercase;color:#444}\
#sn-terms .st-body{flex:1;min-height:0;overflow:hidden;padding:calc(var(--u)*1.4) calc(var(--u)*2.6) calc(var(--u)*.6);font-size:calc(var(--u)*1.6);line-height:1.5;color:#1b1b1b;column-count:2;column-gap:calc(var(--u)*3.2);column-rule:1px solid #d9c9a8;column-fill:auto}\
@media (max-aspect-ratio:1/1){#sn-terms .st-body{column-count:auto;column-rule:none;column-fill:balance}}\
#sn-terms .st-lead{column-span:all;margin:0 0 calc(var(--u)*1.2);padding:calc(var(--u)*1) calc(var(--u)*1.4);background:#ffe9e7;border-left:calc(var(--u)*.6) solid #d10a0a;font-family:"Segoe UI",system-ui,sans-serif;font-weight:800;font-size:1.04em;line-height:1.35;color:#8a0000;text-transform:uppercase}\
#sn-terms h2{margin:calc(var(--u)*1.1) 0 calc(var(--u)*.2);font:800 .82em/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7a0000;break-after:avoid}\
#sn-terms h2:first-of-type{margin-top:0}\
#sn-terms p{margin:0 0 calc(var(--u)*.6);text-align:justify;hyphens:auto;break-inside:avoid}\
#sn-terms .st-seal{position:absolute;right:calc(var(--u)*3);top:calc(var(--u)*6);width:calc(var(--u)*9);height:calc(var(--u)*9);opacity:.1;pointer-events:none}\
#sn-terms .st-foot{flex:none;padding:calc(var(--u)*1.1) calc(var(--u)*2.6) calc(var(--u)*1.2);border-top:calc(var(--u)*.2) solid #111;background:#f4efe3;font-family:"Segoe UI",system-ui,sans-serif}\
#sn-terms label{display:flex;gap:calc(var(--u)*1.2);align-items:flex-start;font-weight:700;font-size:calc(var(--u)*1.5);line-height:1.35;color:#111;cursor:pointer!important}\
#sn-terms label *{cursor:pointer!important}\
#sn-terms input[type=checkbox]{flex:none;width:calc(var(--u)*2.2);height:calc(var(--u)*2.2);margin:0;accent-color:#d10a0a}\
#sn-terms .st-buttons{display:flex;gap:calc(var(--u)*1.2);margin-top:calc(var(--u)*1.1)}\
#sn-terms button{font:800 calc(var(--u)*1.5) "Segoe UI",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:calc(var(--u)*1.1) calc(var(--u)*2.6);border:calc(var(--u)*.3) solid #111;background:#fff;color:#111;transition:transform 120ms,background-color 120ms,box-shadow 120ms}\
#sn-terms button.agree{flex:1;background:#d10a0a;border-color:#7a0000;color:#fff}\
#sn-terms button.agree:not(:disabled):hover{background:#f01212;transform:translateY(calc(var(--u)*-.2));box-shadow:0 calc(var(--u)*.6) 0 #7a0000}\
#sn-terms button.agree:not(:disabled):active{transform:translateY(calc(var(--u)*.1));box-shadow:none}\
#sn-terms button:disabled{opacity:.4;border-style:dashed}\
#sn-terms button.leave:hover{background:#eee}\
#sn-terms .st-fine{margin:calc(var(--u)*.8) 0 0;font-size:calc(var(--u)*1.1);color:#666;line-height:1.3;text-align:left}\
#sn-terms .st-preview{position:absolute;top:calc(var(--u)*3.6);left:50%;transform:translateX(-50%);padding:calc(var(--u)*.4) calc(var(--u)*1.2);background:#111;color:#ffd500;font:800 calc(var(--u)*1.2) "Segoe UI",sans-serif;letter-spacing:.14em;z-index:2}\
@media (prefers-reduced-motion:reduce){#sn-terms .st-tape,#sn-terms .st-wrap{animation:none}#sn-terms button{transition:none}}';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function seal() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "st-seal");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<circle cx="50" cy="50" r="46" fill="none" stroke="#7a0000" stroke-width="3"/><circle cx="50" cy="50" r="38" fill="none" stroke="#7a0000" stroke-width="1.5"/><path d="M50 18l8 20 22 2-17 14 6 21-19-12-19 12 6-21-17-14 22-2z" fill="#7a0000"/>'; // fixed markup, nothing from outside
    return svg;
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
    // Too much text either runs past the bottom, or (in two columns) spills into an extra column to the right.
    var over = function () { return body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1; };
    while (over() && size > 9 && guard++ < 80) {
      size *= 0.97;
      body.style.fontSize = size + "px";
    }
    if (over()) { body.style.columnCount = "auto"; body.style.overflowY = "auto"; body.style.overflowX = "hidden"; }
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
    root.appendChild(el("div", "st-tape"));
    if (preview) root.appendChild(el("div", "st-preview", "PREVIEW: NOTHING IS SAVED"));

    var wrap = el("div", "st-wrap");
    var top = el("div", "st-top");
    var logo = el("img", "st-logo");
    logo.src = LOGO; logo.alt = "SuperNova OS"; logo.width = 92; logo.height = 92;
    top.appendChild(logo);
    top.appendChild(el("div", "st-kicker", "LEGAL NOTICE"));
    top.appendChild(el("h1", "", "Read before you continue"));
    top.appendChild(el("p", "st-sub", "This website must NOT be used during school or to get past school filters."));
    wrap.appendChild(top);

    var paper = el("div", "st-paper");
    var head = el("div", "st-head");
    head.appendChild(el("span", "", "Acceptable use agreement"));
    head.appendChild(el("span", "", "Ref. SN-EDU-AUA · Version 1.0"));
    paper.appendChild(head);
    var body = el("div", "st-body");
    body.tabIndex = 0;
    body.appendChild(el("p", "st-lead", "Important: this website was made only for education and for learning open source programming. It is not to be used during school, and it is not to be used to get around school filters or any other restriction."));
    SECTIONS.forEach(function (s) { body.appendChild(el("h2", "", s[0])); body.appendChild(el("p", "", s[1])); });
    paper.appendChild(body);
    paper.appendChild(seal());

    var foot = el("div", "st-foot");
    var label = el("label");
    var box = el("input");
    box.type = "checkbox";
    label.appendChild(box);
    label.appendChild(el("span", "", "I have read and understood this notice. I will not use this website during school or to get past school filters, and I accept these terms."));
    var buttons = el("div", "st-buttons");
    var agree = el("button", "agree", "I agree — continue");
    agree.type = "button"; agree.disabled = true;
    var leave = el("button", "leave", preview ? "Close preview" : "I do not agree — leave");
    leave.type = "button";
    buttons.appendChild(agree); buttons.appendChild(leave);
    foot.appendChild(label); foot.appendChild(buttons);
    foot.appendChild(el("p", "st-fine", preview ? "This is how everyone who is not signed in will see it. It is shown once to each person." : "Your agreement is kept on this device only. You are asked once. Signed-in accounts are not shown this notice."));
    paper.appendChild(foot);
    wrap.appendChild(paper);
    root.appendChild(wrap);
    root.appendChild(el("div", "st-tape bottom"));
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
