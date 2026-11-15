/*
 * Profile cards: click someone's name or picture (in the Chat, Friends or the App Store) and a small card opens
 * with their picture, roles, when they joined, their bio, the friends you have in common, and what you can do:
 * add them as a friend, accept or cancel, and (where the page offers it) mention them in the chat or moderate them.
 *
 *   SnProfile.open("name", { anchor: element, onMention: fn(name), onModerate: fn(name) })
 *
 * Everything shown is put on the page as text. Needs /proxy/account.js (for picture addresses). Plain script.
 */
(function (global) {
  "use strict";

  var COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  var card = null;     // the open card
  var openFor = null;  // the name it is about
  var options = {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function colorFor(name) {
    var hash = 0;
    String(name).split("").forEach(function (char) { hash = (hash * 31 + char.charCodeAt(0)) >>> 0; });
    return COLORS[hash % COLORS.length];
  }

  function api(method, path, body) {
    return fetch("/api/friends" + path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var error = new Error(data.error || "Something went wrong (" + res.status + ")."); error.status = res.status; throw error; }
        return data;
      });
    });
  }

  function avatar(person, size) {
    var node = el("span", "pc-avatar " + (size || ""));
    var letter = function () { node.textContent = ""; node.style.background = colorFor(person.username); node.appendChild(document.createTextNode(person.username.charAt(0).toUpperCase())); };
    var url = global.SnAccount && global.SnAccount.avatarUrl ? global.SnAccount.avatarUrl(person.username, person.avatar) : "";
    if (!url) { letter(); return node; }
    var img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", letter, { once: true });
    img.src = url;
    node.appendChild(img);
    return node;
  }

  function close() {
    if (card) { card.remove(); card = null; openFor = null; }
  }

  /** Put the card beside what was clicked, inside the window. */
  function place(node, anchor) {
    var width = node.offsetWidth, height = node.offsetHeight;
    var viewW = document.documentElement.clientWidth, viewH = document.documentElement.clientHeight;
    var left, top;
    if (anchor && anchor.getBoundingClientRect) {
      var box = anchor.getBoundingClientRect();
      left = box.right + 8;
      if (left + width > viewW - 4) left = box.left - width - 8;
      if (left < 4) left = Math.max(4, Math.min(box.left, viewW - width - 4));
      top = box.top;
    } else {
      left = (viewW - width) / 2;
      top = (viewH - height) / 2;
    }
    top = Math.max(4, Math.min(top, viewH - height - 4));
    node.style.left = Math.round(left) + "px";
    node.style.top = Math.round(top) + "px";
  }

  function monthYear(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" }); } catch (e) { return ""; }
  }

  function render(profile, anchor) {
    var node = card;
    if (!node) return;
    node.textContent = "";
    var top = profile.roles && profile.roles[0];
    var banner = el("div", "pc-banner");
    banner.style.background = top ? top.color : "";
    node.appendChild(banner);

    var head = el("div", "pc-head");
    var picture = avatar(profile, "big");
    if (profile.status) picture.setAttribute("data-status", profile.status);
    head.appendChild(picture);
    var title = el("div", "pc-title");
    var name = el("strong", "pc-name", profile.username);
    if (top) name.style.color = top.color;
    title.appendChild(name);
    if (profile.status) title.appendChild(el("span", "pc-status", profile.status === "offline" ? "Offline" : profile.status === "away" ? "Away" : "Online"));
    head.appendChild(title);
    node.appendChild(head);

    if (profile.roles && profile.roles.length) {
      var roles = el("div", "pc-roles");
      profile.roles.forEach(function (role) {
        var chip = el("span", "pc-role", role.name);
        chip.style.borderColor = role.color;
        chip.style.color = role.color;
        roles.appendChild(chip);
      });
      node.appendChild(roles);
    }
    if (profile.bio) node.appendChild(el("p", "pc-bio", profile.bio));
    node.appendChild(el("p", "pc-meta", "Member since " + monthYear(profile.joinedAt)));

    if (!profile.self && profile.mutual) {
      var mutual = el("div", "pc-mutual");
      var n = profile.mutual.count;
      mutual.appendChild(el("span", "pc-label", n ? n + " mutual friend" + (n === 1 ? "" : "s") : "No friends in common yet"));
      if (n) {
        var faces = el("div", "pc-faces");
        profile.mutual.people.forEach(function (person) {
          var face = avatar(person, "small");
          face.title = person.username;
          faces.appendChild(face);
        });
        mutual.appendChild(faces);
      }
      node.appendChild(mutual);
    }

    var note = el("p", "pc-note");
    note.setAttribute("role", "status");
    var buttons = el("div", "pc-buttons");
    var act = function (label, path, kind) {
      var button = el("button", "pc-btn " + (kind || ""), label);
      button.type = "button";
      button.addEventListener("click", function () {
        button.disabled = true;
        api("POST", path, { username: profile.username }).then(function () { return refresh(anchor); }).catch(function (err) { note.textContent = err.message; button.disabled = false; });
      });
      return button;
    };
    if (profile.self) {
      node.appendChild(el("p", "pc-meta", "This is how other people see you. Change your picture and bio in Settings > Account."));
    } else {
      var relation = profile.relation || {};
      if (relation.blockedByMe) buttons.appendChild(act("Unblock", "/unblock"));
      else if (relation.friends) buttons.appendChild(act("Remove friend", "/remove", "quiet"));
      else if (relation.pending === "in") { buttons.appendChild(act("Accept request", "/accept", "primary")); buttons.appendChild(act("Decline", "/decline", "quiet")); }
      else if (relation.pending === "out") buttons.appendChild(act("Cancel request", "/cancel", "quiet"));
      else buttons.appendChild(act("Add friend", "/request", "primary"));
      if (options.onMention) {
        var mention = el("button", "pc-btn", "Mention");
        mention.type = "button";
        mention.addEventListener("click", function () { var who = profile.username; close(); options.onMention(who); });
        buttons.appendChild(mention);
      }
      if (options.onModerate) {
        var moderate = el("button", "pc-btn quiet", "Moderate…");
        moderate.type = "button";
        moderate.addEventListener("click", function () { var who = profile.username; close(); options.onModerate(who); });
        buttons.appendChild(moderate);
      }
      if (typeof global.SnProfile.extraButtons === "function") global.SnProfile.extraButtons(profile, buttons, note, close);
    }
    node.appendChild(buttons);
    node.appendChild(note);
    place(node, anchor);
  }

  function refresh(anchor) {
    var name = openFor;
    return api("GET", "/profile/" + encodeURIComponent(name)).then(function (profile) {
      if (openFor === name) render(profile, anchor);
    });
  }

  function open(username, opts) {
    options = opts || {};
    if (card && openFor === username) { close(); return; } // clicking the same name again closes it
    close();
    openFor = username;
    card = el("div", "pcard");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Profile of " + username);
    card.appendChild(el("p", "pc-loading", "Loading…"));
    // A modal dialog makes everything outside it unreachable, so the card goes inside the open one.
    (document.querySelector("dialog[open]") || document.body).appendChild(card);
    place(card, options.anchor);
    var anchor = options.anchor;
    refresh(anchor).catch(function (err) {
      if (!card) return;
      card.textContent = "";
      card.appendChild(el("p", "pc-loading", err.status === 404 ? "There's no one with that name." : err.message));
      place(card, anchor);
    });
  }

  document.addEventListener("mousedown", function (event) {
    if (card && !card.contains(event.target) && !(event.target.closest && event.target.closest("[data-profile]"))) close();
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });

  global.SnProfile = { open: open, close: close, avatar: avatar, extraButtons: null };
})(self);
