/* TODO:
- Add a way to right click on the desktop and create a new application.
*/

//https://api.github.com/repos/PicturElements/picturelements.github.io/contents

var xStart = 0, yStart = 0, selWin = 0;
var prevX = 0, prevY = 0;
var clicked = false, resize = false, setFullscreen = 0, attr, select = false, preventEvents = false, expanded = false, slide = false;
var lockTaskbar = true, lockTaskbah = false, hide = true, preventHide = false;
var windows = [], origNames = [], winCount = 0, hiddenApps = 6, permaStickied = 3;  //permaStickied denotes the taskbar icons that cannot be unpinned, and so don't get included in the editable taskArr array.
var last = 0;
var contextAssort = [
  [0, 1, 2, 3, 17],
  [4, 5, 6, 7],
  [8, 9, 10, 18],
  [11, 12],
  [6, 7],
  [7],
  [13, 14, 15, 16]
];
var types = {
  doc: ["css", "Cascading Style Sheet file", "js", "JavaScript file", "html", "HTML document", "json", "JavaScript Object Notation file", "ahk", "AutoHotKey script", "txt", "Plain text document", "zip", "Compressed archive", "hs", "Haskell file", "java", "Java file", "py", "Python script file"],
  img: ["jpg", "JPEG image", "jpeg", "JPEG image", "png", "PNG image", "bmp", "BMP image", "gif", "GIF image"],
  audio: ["mp3", "MP3 audio file", "wav", "Waveform file"],
  font: ["otf", "OpenType font file", "ttf", "TrueType font file"]
};
var colors = [
  ["#600", "#d42", "#d77", "#ff5e5e 0%,#bd1929 38%,#0e0000 100%"],
  ["#060", "#3a2", "#7f5", "#64e25e 0%,#098022 38%,#051700 100%"],
  ["#005", "#53f", "#29f", "#64a4c4 0%,#1c5d9e 38%,#1c0935 100%"],
  ["#a40", "#d72", "#da4", "#ffbb5e 0%,#b14b03 38%,#350f00 100%"],
  ["#317", "#74a", "#85f", "#ae41cc 0%,#53136d 38%,#000000 100%"],
  ["#222", "#333", "#777", "#696969 0%,#232323 50%,#000000 100%"],
  ["#999", "#aaa", "#ddd", "#e8e8e8 0%,#a0a0a0 50%,#1f1f1f 100%"]
];
var specCols = ["#68c464 0%,#1c5d9e 38%,#50005f 100%"];
// One readable accent per colour scheme, shared with the apps (see theme.js).
var accents = ["#e0533d", "#43b84a", "#6b5cff", "#e8892e", "#8f5bd6", "#8a8fa8", "#cfd2e0"];
var backgrounds = ["Adventure_Time.gif", "Bouncy.jpg", "space.jpg", "Flower.jpg", "Bucks.jpg", "Leaf.jpg", "LonelyRoad.jpg", "Flowers.jpg", "Mandelbrot.png", "Match.jpg", "rocks.png", "Andromeda.jpg", "CrabNebula.jpg", "OrionNebula.jpg", "Pillars.jpg", "Saturn.jpg", "WebbDeepField.jpg", "Synthwave.jpg", "NeonGrid.jpg", "Invaders.jpg", "Matrix.jpg"];
contextShow = false, next = null;

// Load saved desktop state (see /proxy/store.js).
var taskArr = [0, 2], oftenUsed = [];
var tzIndex = SnStore.get("tzIndex") || 0, tzOffset = SnStore.get("tzOffset") || 0;
var tmpArr = SnStore.get("taskArr");
taskArr = tmpArr != null ? tmpArr.split(",") : taskArr;
var DEF_WIN_W = parseInt(SnStore.get("winW")) || 60;
var DEF_WIN_H = parseInt(SnStore.get("winH")) || 35;
var ou = SnStore.get("oftenUsed");
if (ou != null) { oftenUsed = ou.split(","); }
var colId = 4, backId = 3; /*This changes the defualt wallpaper.*/
// Saved values can come from an older version or an imported backup: keep only
// ones that make sense here, or setCols and classList.add would throw.
var ci = parseInt(SnStore.get("colId"));
if (ci >= 0 && ci < colors.length) { colId = ci; }
var bi = parseInt(SnStore.get("backId"));
if (bi >= 0 && bi <= backgrounds.length) { backId = bi; }
if (!isFinite(Number(tzOffset))) { tzOffset = 0; }
lockTaskbar = SnStore.get("lockTaskbar") != "0";
document.getElementById("taskbar").className = lockTaskbar ? "locked" : "unlocked";
document.body.classList.add(SnStore.get("viewmode") === "table" ? "table" : "grid");

const service = "supernova";

var programData = [ //name, url, icon, keywords
  { name: "SuperNova", url: "/apps/browser.html", icon: { url: "SuperNova" }, keywords: "proxy,browser,web,internet,unblocker,search,supernova,tabs" },
  { name: "Slither.io", url: "", proxy: "https://slither.io/", icon: { url: "slither" }, keywords: "slither,snake,io,multiplayer,game" },
  { name: "Krunker", url: "", proxy: "https://krunker.io/", icon: { url: "krunker" }, keywords: "krunker,shooter,fps,io,multiplayer,game" },
  { name: "Skribbl.io", url: "", proxy: "https://skribbl.io/", icon: { url: "skribbl" }, keywords: "skribbl,drawing,guess,party,multiplayer,game" },
  { name: "2048", url: "", proxy: "https://play2048.co/", icon: { url: "g2048" }, keywords: "2048,puzzle,numbers,tiles,game" },
  { name: "Minecraft", url: "", proxy: "https://eaglercraft.com/mc/1.8.8/", icon: { url: "minecraft" }, keywords: "minecraft,eaglercraft,building,survival,sandbox,game" },
  { name: "Smash Karts", url: "", proxy: "https://smashkarts.io/", icon: { url: "smashkarts" }, keywords: "smash,karts,racing,kart,multiplayer,game" },
  { name: "Bloxd.io", url: "", proxy: "https://bloxd.io/", icon: { url: "bloxd" }, keywords: "bloxd,blocks,building,minecraft,multiplayer,game" },
  { name: "Diep.io", url: "", proxy: "https://diep.io/", icon: { url: "diep" }, keywords: "diep,tanks,io,multiplayer,game" },
  { name: "Paper.io 2", url: "", proxy: "https://paper-io.com/", icon: { url: "paperio2" }, keywords: "paper,io,territory,multiplayer,game" },
  { name: "Zombs.io", url: "", proxy: "https://zombs.io/", icon: { url: "zombs" }, keywords: "zombs,zombies,survival,tower,defense,io,multiplayer,game" },
  { name: "Survev.io", url: "", proxy: "https://survev.io/", icon: { url: "survev" }, keywords: "survev,surviv,battle royale,shooter,io,multiplayer,game" },
  { name: "Cookie Clicker", url: "", proxy: "https://cookieclicker.ee/", icon: { url: "cookieclicker" }, keywords: "cookie,clicker,idle,incremental,game" },
  { name: "MooMoo.io", url: "", proxy: "https://moomoo.io/", icon: { url: "moomoo" }, keywords: "moomoo,survival,io,multiplayer,game" },

  { name: "Viewer", url: "", icon: { url: "viewer" }, keywords: "" },
  { name: "Console", url: "", icon: { url: "console" }, keywords: "" },
  { name: "Prompt", url: "", icon: { svg: "info_icon" }, keywords: "" },
  { name: "Settings", url: "/apps/settings.html", icon: { svg: "cog_icon" }, keywords: "" },
  { name: "File Explorer", url: "", icon: { url: "explorer" }, keywords: "" },
  { name: "Chat", url: "/apps/chat.html", icon: { svg: "chat_icon" }, keywords: "" }
];

pl = programData.length;
// The Chat was added after these, at the very end, so every id that existed before keeps its number.
var viewerID = pl - 6, consoleID = pl - 5, errID = pl - 4, setID = pl - 3, explorerID = pl - 2, chatID = pl - 1;

// ---------------------------------------------------------------------------
// Custom apps: web apps the user puts on the desktop. They are stored in SnStore
// under "customApps" as a JSON array of { name, url } and come after the built-in
// apps, so adding one never changes the id of anything else (pins, launch counts
// and saved names all refer to apps by id). A removed app leaves null in its slot
// for the same reason.
// ---------------------------------------------------------------------------
var builtinCount = programData.length;

// Saved pins (taskArr) and launch counts (oftenUsed) number the apps the way they were when
// they were first saved: the 19 built-in apps that existed then, then the custom apps. Apps
// added since (the Chat) sit between them in memory, so ids are translated where they are
// read from and written to storage. What is saved stays valid for older versions, other
// browsers on the same account and backups, and nothing in storage ever needs rewriting.
var SAVED_BUILTINS = 19;
function liveId(id) { return id >= SAVED_BUILTINS ? id - SAVED_BUILTINS + builtinCount : id; }
function savedId(id) { return id >= builtinCount ? id - builtinCount + SAVED_BUILTINS : id; }
taskArr = taskArr.map(function (id) { return liveId(Number(id)); });
if (oftenUsed.length > SAVED_BUILTINS) {
  for (var room = builtinCount - SAVED_BUILTINS; room > 0; room--) { oftenUsed.splice(SAVED_BUILTINS, 0, 0); }
}
function saveTaskArr() {
  SnStore.set("taskArr", taskArr.map(function (id) { return savedId(Number(id)); }));
}
function saveOftenUsed() {
  // The apps added since have no saved slot: leave them out.
  SnStore.set("oftenUsed", oftenUsed.slice(0, SAVED_BUILTINS).concat(oftenUsed.slice(builtinCount)));
}
var CUSTOM_APPS_MAX = 50, APP_NAME_MAX = 40;
var LETTER_COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];

function isCustomApp(id) {
  return Number(id) >= builtinCount;
}

function readCustomApps() {
  try {
    var list = JSON.parse(SnStore.get("customApps") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeCustomApps(list) {
  while (list.length && list[list.length - 1] == null) { list.pop(); }
  SnStore.set("customApps", JSON.stringify(list));
}

function cleanAppName(name) {
  return String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, APP_NAME_MAX).trim();
}

function removedApp() {
  return { name: "", url: "", icon: { letter: "" }, keywords: "", removed: true };
}

// The programData entry for a stored custom app. Stored data may come from an import
// or an old version, so it is validated again here: only http(s) addresses survive.
function customAppEntry(app) {
  var url = app && typeof app.url === "string" ? SnResolve.toUrl(app.url) : null;
  if (!url) { return removedApp(); }
  var host = new URL(url).hostname.replace(/^www\./, "");
  var name = cleanAppName(app.name) || host;
  var hash = 0;
  for (var i = 0; i < host.length; i++) { hash = (hash * 31 + host.charCodeAt(i)) >>> 0; }
  return {
    name: name,
    url: "",
    proxy: url,
    custom: true,
    icon: { letter: name.charAt(0).toUpperCase(), color: LETTER_COLORS[hash % LETTER_COLORS.length] },
    keywords: host + ",app,web" // a hostname: safe to insert as search-result markup
  };
}

readCustomApps().forEach(function (app) { programData.push(customAppEntry(app)); });

// The apps shown on the desktop, in the launcher and in search, by id.
function desktopAppIds() {
  var ids = [];
  for (var i = 0; i < programData.length; i++) {
    if (i < builtinCount - hiddenApps || (i >= builtinCount && !programData[i].removed)) { ids.push(i); }
  }
  return ids;
}

function desktopLink(id) {
  return document.querySelector(".desktoplink[data-app='" + Number(id) + "']");
}

// Settings and the Console are pinned permanently. Listing them in taskArr as well pinned
// them twice, which rewrote the icon's click handler to minWin(null) and made it crash
// (this is how the File Explorer icon broke). Also drop duplicates and ids that no longer exist.
taskArr = taskArr.map(Number).filter(function (id, index, all) {
  return id >= 0 && id < programData.length && !programData[id].removed && id !== setID && id !== consoleID && id !== chatID && all.indexOf(id) === index;
});
var defaultPage = "https://api.github.com/repos/SuperNova-Network/SuperNova-DY/contents"; // go to https://api.github.com/users/SuperNova-Network/repos and find "contents_url" to get the url for the default page. EX: https://media.discordapp.net/attachments/828071279424307221/1203153358597394534/image.png?ex=65d00ee2&is=65bd99e2&hm=9a4f32904842838ea9a40c8f45e2b860491aee8c4b55cb6fa4b7f995f5f64aff&=&format=webp&quality=lossless&width=1439&height=206
// https://web.postman.co/

document.body.addEventListener("mousedown", function (event) { winSelect = true; xStart = event.clientX; yStart = event.clientY; hideSearch(); });
document.body.addEventListener("mousemove", function (event) { try { moveWindow(event); } catch (e) { } });
document.body.addEventListener("mouseup", function (event) { try { release(event); } catch (e) { } });
document.getElementById("search").addEventListener("keyup", search);
document.getElementById("searchbar").addEventListener("mousedown", function (event) { showSearch(event); });
document.getElementById("home").addEventListener("mousedown", function (event) { showHome(event); });
document.getElementById("taskbar").addEventListener("mousedown", function (event) { showContext(event, 3); });
document.getElementsByClassName("poweritem")[0].addEventListener("mousedown", function () { restart(); });
document.getElementsByClassName("poweritem")[1].addEventListener("mousedown", function (event) { powerOff(event); });
document.getElementsByClassName("contextitem")[0].addEventListener("mousedown", function (event) { contextOpen(event, false); });
document.getElementsByClassName("contextitem")[1].addEventListener("mousedown", function (event) { contextOpen(event, true); });
document.getElementsByClassName("contextitem")[2].addEventListener("mousedown", function (event) { contextEdit(); });
document.getElementsByClassName("contextitem")[3].addEventListener("mousedown", function (event) { contextPin(0); });
document.getElementsByClassName("contextitem")[4].addEventListener("mousedown", function (event) { contextPin(1); });
document.getElementsByClassName("contextitem")[5].addEventListener("mousedown", function () { contextUnpin(); });
document.getElementsByClassName("contextitem")[6].addEventListener("mousedown", function (event) { contextAddWin(event); });
document.getElementsByClassName("contextitem")[7].addEventListener("mousedown", function () { contextClose(); });
document.getElementsByClassName("contextitem")[8].addEventListener("mousedown", function () { toggleFullscreen(); });
document.getElementsByClassName("contextitem")[9].addEventListener("mousedown", function () { contextShow = !contextShow; });
document.getElementsByClassName("contextitem")[10].addEventListener("mousedown", function () { openSettings("appearance"); });
document.getElementsByClassName("contextitem")[11].addEventListener("mousedown", function () {
  lockTaskbar = !lockTaskbar;
  SnStore.set("lockTaskbar", lockTaskbar ? 1 : 0);
  document.getElementById("taskbar").className = lockTaskbar ? "locked" : "unlocked";
});
document.getElementsByClassName("contextitem")[12].addEventListener("mousedown", function () { toggleTaskbah(); });
document.getElementsByClassName("contextitem")[13].addEventListener("mousedown", function () { contextOpenFile(); });
document.getElementsByClassName("contextitem")[14].addEventListener("mousedown", function () { contextNewDir(false); });
document.getElementsByClassName("contextitem")[15].addEventListener("mousedown", function () { contextNewDir(true); });
document.getElementsByClassName("contextitem")[16].addEventListener("mousedown", function () { contextOpenHTML(); });
document.getElementsByClassName("contextitem")[17].addEventListener("mousedown", function () { confirmRemoveApp(document.getElementById("context").getAttribute("target")); });
document.getElementsByClassName("contextitem")[18].addEventListener("mousedown", function () { openAddAppDialog(); });

document.getElementById("context").addEventListener("mousedown", function () { document.getElementById("context").style.display = "none"; preventHide = false; });
document.getElementById("desktop").addEventListener("mousedown", function (event) {
  xStart = event.clientX;
  yStart = event.clientY;
  if (!clicked) { select = true; }
  var elem = document.getElementsByClassName("desktoplink");
  for (var i = 0; i < elem.length; i++) {
    elem[i].setAttribute("selected", false);
  }
  document.getElementById("context").style.display = "none";
  preventHide = false;
  hideSearch();
  document.getElementById("clockbar").style.display = "none";
  showContext(event, 2);
  event.stopPropagation();
});
document.getElementById("search").addEventListener("mousedown", function (event) { showSearchFull(event); });
document.getElementById("taskbar").addEventListener("mousemove", function (event) { event.stopPropagation(); });

// Desktop icons stay in id order: built-in apps first, then custom apps.
function addDesktopIcon(id) {
  var parent = document.getElementById("desktop");
  var el = document.createElement("div");
  el.className = "desktoplink";
  el.title = programData[id].name;
  el.setAttribute("data-app", id);
  el.setAttribute("selected", "false");
  el.setAttribute("onclick", "selectIcon(event," + id + ",false)");
  el.addEventListener("mousedown", function (event) { showContext(event, 0) });
  el.innerHTML = "<div class='icon'></div> <p class='ddesc'>" + escapeHtml(programData[id].name) + "</p>";
  setIcon(programData[id].icon, el.getElementsByClassName("icon")[0]);
  var links = parent.getElementsByClassName("desktoplink"), before = null;
  for (var i = 0; i < links.length; i++) {
    if (Number(links[i].getAttribute("data-app")) > id) { before = links[i]; break; }
  }
  if (!before && links.length) { before = links[links.length - 1].nextSibling; }
  parent.insertBefore(el, before);
}

function setup() {
  for (var i = 0; i < programData.length; i++) {
    oftenUsed[i] = parseInt(oftenUsed[i]) || 0;
  }
  for (var i = 0; i < builtinCount - hiddenApps; i++) {
    origNames.push(programData[i].name);
    if (SnStore.get("customTitle" + i) != null) {
      programData[i].name = SnStore.get("customTitle" + i);
    }
  }
  desktopAppIds().forEach(addDesktopIcon);
  //create cog
  document.getElementById("cog").setAttribute("d", genCog(19));
  // Draw the cog icon in the shared buffer before any copy of it is made. Looking it up
  // by class took the first copy in the page (e.g. the taskbar pin), so copies made
  // later, like the Settings title-bar icon, stayed an empty circle.
  document.querySelector("#svgbuffer .cog_icon path").setAttribute("d", genCog(40));

  addTaskbarIcon(setID, "null", 0, programData[setID].name, programData[setID].icon, true);
  addTaskbarIcon(chatID, "null", 0, programData[chatID].name, programData[chatID].icon, true);
  addTaskbarIcon(consoleID, "null", 0, programData[consoleID].name, programData[consoleID].icon, true);
  for (var i = 0; i < taskArr.length; i++) {
    addTaskbarIcon(taskArr[i], "null", 0, programData[taskArr[i]].name, programData[taskArr[i]].icon, true);
  }
  setCols();
  setTimeout(function () {
    var elem = document.getElementById("loadscreen");
    elem.innerHTML = document.getElementById("loadscreenbuffer").innerHTML;
    elem.style.backgroundColor = "#111";
  }, 500);

  //create clock face
  var clock = document.getElementById("clocksvg");
  var rOuter = 45, ri = 37, ri2 = 43;
  for (var i = 0; i < 60; i++) {
    var rad = i % 5 == 0 ? ri : ri2;
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    var sin = Math.sin(i / 30 * Math.PI), cos = Math.cos(i / 30 * Math.PI)
    line.setAttribute("x1", round(50 - sin * rOuter, 2));
    line.setAttribute("y1", round(50 - cos * rOuter, 2));
    line.setAttribute("x2", round(50 - sin * rad, 2));
    line.setAttribute("y2", round(50 - cos * rad, 2));
    line.setAttribute("stroke", "#888");
    clock.appendChild(line);
  }
}
setup();

function genCog(r) {
  var dimple = 0.8, pins = 8, part = 0.8, step = 1 / pins;
  var angle = -0.5 / pins * Math.PI;
  var out = "M" + (round(45 + Math.sin(angle) * r, 2)) + " " + (round(45 + Math.cos(angle) * r, 2));
  for (var i = 1; i < pins * 4; i++) {
    var newStep = i % 2 == 0 ? 1 - part : part;
    var rad = i % 4 < 2 ? r : dimple * r;
    angle += newStep * step * Math.PI;
    out += (" L" + (round(45 + Math.sin(angle) * rad, 2)) + " " + (round(45 + Math.cos(angle) * rad, 2)));
  }
  return out + "Z";
}

// A user-supplied wallpaper address. Only http(s) is accepted, and quotes are
// escaped so the value cannot break out of the CSS url('...').
function customBackgroundCss() {
  var url = SnStore.get("backgroundUrl");
  if (!url) return "";
  var parsed;
  try { parsed = new URL(url, location.href); } catch (e) { return ""; }
  if (!/^https?:$/.test(parsed.protocol)) return "";
  return ".backOverride{background:none; background-image:url('" + parsed.href.replace(/['\\]/g, encodeURIComponent) + "');}";
}

function setCols() {
  document.getElementById("specCols").innerHTML = ".specColor{background-color:" + colors[colId][0] + "; border-color:" + colors[colId][0] + ";}\n.window[active='true'] .infoCol, .normCol{background-color:" + colors[colId][1] + ";}\n.borderCol{border-color:" + colors[colId][2] + " !important;}\n.grad{background: -moz-linear-gradient(-45deg, " + colors[colId][3] + "); background: -webkit-linear-gradient(-45deg, " + colors[colId][3] + "); background: linear-gradient(135deg, " + colors[colId][3] + "); background: linear-gradient(135deg, " + colors[colId][3] + ");}" + (backId != 0 ? ".backOverride{background:none; background-image:url(/resources/media/wallpapers/" + backgrounds[backId - 1] + ");}" : "") + customBackgroundCss();
  if (window.SnStore) { SnStore.set("accent", accents[colId] || ""); }
}

function factoryReset() {
  document.write("Your system is being reset. Please wait...");

  setTimeout(function () {
    document.body.innerHTML = ''; // Remove all elements
    document.body.style.backgroundColor = 'black'; // Change background color to black

    setTimeout(function () {
      SnStore.clear();
      location.reload();
    }, 700);
  }, 1000);
}

function addWindow(id, title, contStr, w, h, type) {
  oftenUsed[id]++;
  saveOftenUsed();

  // The Browser app (id 0) receives its first address or search as contStr.
  // contStr: the Browser (id 0) gets its first query, Settings (setID) the section to show.
  var tmpUrl = id == viewerID ? contStr
    : (id == 0 && contStr ? programData[id].url + "?q=" + encodeURIComponent(contStr)
      : (id == setID && contStr ? programData[id].url + "#" + encodeURIComponent(contStr) : programData[id].url));
  var elem = document.createElement("div");
  elem.className = "window init";
  var data = {
    icon: type != null ? type + "-viewer" : programData[id].icon,
    name: title != null ? title : programData[id].name
  };

  //prevents multiple settings panels (and multiple chats: one live connection is enough)
  if (id == setID || id == chatID) {
    var wins = document.getElementsByClassName("window");
    for (var i = 0; i < wins.length; i++) {
      if (wins[i].getAttribute("type") == (id == chatID ? String(chatID) : "settings")) {
        windows[i].collapsed = false;
        moveToTop(i);
        if (contStr && id == setID) {
          // Jump the open Settings window to the requested section.
          try { wins[i].getElementsByTagName("iframe")[0].contentWindow.location.hash = contStr; } catch (e) { }
        }
        return wins[i];
      }
    }
  }

  elem.setAttribute("type", id);
  var inner = "<div class='infobar infoCol' id='" + winCount + "'><div class='close' title='Close' onclick=closeWin(" + winCount + ")>✕</div><div class='max' title='Toggle' onclick=toggle(" + winCount + ")>◻</div><div class='min' title='Minimize' onclick=minWin(" + winCount + ")>_</div><div class='reload' title='Reload' onclick=reloadWin(" + winCount + ")>↻</div><div class='icon'></div><div class='wintitle'>" + escapeHtml(data.name) + "</div></div><div class='contentwrapper'><div class='content'><iframe class='frame' allow='fullscreen; autoplay; clipboard-read; clipboard-write; gamepad; encrypted-media; microphone; camera' allowfullscreen></iframe><div class='loadingoverlay'><div class='loader'></div><div class='loader2'></div><div class='loader3'></div></div></div><div class='resize' scale='lw'></div><div class='resize' scale='h'></div><div class='resize' scale='w'></div><div class='resize' scale='th'></div><div class='resize' scale='lwh'></div><div class='resize' scale='wh'></div><div class='resize' scale='thw'></div><div class='resize' scale='thlw'></div></div></div>";
  elem.innerHTML = inner;
  elem.setAttribute("active", true);
  elem.id = winCount;
  setIcon(programData[id].icon, elem.getElementsByClassName("icon")[0]);
  document.getElementById("desktop").appendChild(elem);
  if (id == 0) {
    document.getElementById("desktop").lastChild.addEventListener("mousedown", function (event) { event.stopPropagation(); });
  }
  var resizers = elem.getElementsByClassName("resize");
  for (var i = 0; i < resizers.length; i++) {
    resizers[i].addEventListener("mousedown", function (event) { try { press(event, true); } catch (e) { alert("resize error: " + e); } });
  }
  var elm = elem.getElementsByClassName("infobar")[0];
  elm.addEventListener("mousedown", function (event) { try { press(event, false); } catch (e) { alert("infobar error: " + e); } });
  elem.style.width = w + "em";
  elem.style.height = h + "em";
  elem.style.left = ((100 - w) / 200) * window.innerWidth + "px";
  elem.style.top = Math.abs(window.innerHeight / 2 - (h / 200) * window.innerWidth) + "px";
  windows.push({
    xPos: [((100 - w) / 200) * window.innerWidth, 0],
    yPos: [Math.abs(window.innerHeight / 2 - (h / 200) * window.innerWidth), 0],
    z: winCount - 1,   //I'm not entirely sure why this works...
    sizeX: [w, 100],
    sizeY: [h, (window.innerHeight / window.innerWidth) * 100 - (lockTaskbar ? 3 : 0)],
    edit: 0,
    collapsed: false
  });

  if (id == errID || id == setID || id == explorerID || id == consoleID || id == chatID) {
    elem.addEventListener("mousedown", function (event) {
      var win = getParent(event.target, "window");
      moveToTop(parseInt(win.id));
      document.getElementById("context").style.display = "none";
      event.stopPropagation();
    });
  }

  if (id >= viewerID && !isCustomApp(id)) {
    elem.classList.add("system_window");
  }

  if (id == errID) {
    addContent(elem, "<div class='errimg'></div><div class='errmsg'>" + contStr + "</div>");
    setIcon(programData[errID].icon, elem.getElementsByClassName("errimg")[0]);
    elem.setAttribute("type", "error");
    elem.classList.add("icons_hidden");
  } else if (id == setID) {
    elem.setAttribute("type", "settings");
  } else if (id == explorerID) {
    addContent(elem, document.getElementById("explorerbuffer").innerHTML);
    loadRepos(elem.getElementsByClassName("sidelinkwrapper")[0]);
    elem.setAttribute("type", "explorer");
    elem.getElementsByClassName("path")[0].addEventListener("keydown", function (event) {
      if (event.keyCode == 13) {
        parseGeneralURL(event.target, event.target.value);
      }
    });
    elem.getElementsByClassName("filecontent")[0].addEventListener("mousedown", function (event) { showContext(event, 6); });
    windows[winCount].history = [];
    windows[winCount].histPointer = -2;
    var btns = elem.getElementsByClassName("histbtn");
    btns[0].setAttribute("onclick", "moveHist(" + winCount + ",-1)");
    btns[1].setAttribute("onclick", "moveHist(" + winCount + ",1)");
    parseGeneralURL(elem, contStr != null ? contStr : defaultPage);
    elem.getElementsByClassName("path")[0].addEventListener("focus", function (event) { event.target.select(); });
  } else if (id == consoleID) {
    var content = elem.getElementsByClassName("content")[0];
    addContent(elem, document.getElementById("consolebuffer").innerHTML);
    content.style = "background-color:black; color:white";
    new Console(content);
  } else if (type != null) {
    elem.classList.add(data.icon);
    elem.setAttribute("type", viewerID);
    id = viewerID;
  }

  setTimeout(function () { elem.classList.remove("init"); }, 200);
  addTaskbarIcon(id, winCount, 2, data.name, data.icon, false);
  moveToTop(winCount);
  if (id < consoleID || id == setID || id == chatID || isCustomApp(id)) { delayIframe(elem, tmpUrl, programData[id].proxy, programData[id].custom); }
  winCount++;
  return elem;
}

// checkFilter: ask the content filter first (custom apps). Built-in apps skip the
// round trip; the Wisp server enforces the filter for every connection either way.
function delayIframe(elem, src, proxyTarget, checkFilter) {
  setTimeout(function () {
    var iframe = elem.getElementsByClassName("frame")[0];
    var load = function (url) {
      iframe.src = url;
      iframe.onload = function () {
        elem.getElementsByClassName("loadingoverlay")[0].style = "opacity: 0; background-color:transparent";
      };
    };
    if (proxyTarget) {
      // Proxied apps only work once the service worker is active and the
      // transport is connected. Wait for that, then encode the URL with the
      // currently selected engine.
      (checkFilter ? SnProxy.open(proxyTarget) : SnProxy.go(proxyTarget)).then(load, function (err) {
        elem.getElementsByClassName("loadingoverlay")[0].style = "opacity: 0; background-color:transparent";
        openPopup("Proxy error", err.message);
      });
    } else {
      load(src);
    }
  }, 500);
}

function addContent(elem, html) {
  var content = elem.getElementsByClassName("content")[0];
  content.innerHTML = html;
}

function addTaskbarIcon(id, count, actLvl, name, icon, stickied) {
  var elems = document.getElementsByClassName("taskbaricon");
  for (var i = 0; i < elems.length; i++) {
    if (elems[i].classList.contains("stickied") && elems[i].getAttribute("type") == id && elems[i].getAttribute("activelevel") == 0) {
      elems[i].setAttribute("activelevel", actLvl);
      elems[i].id = count;
      elems[i].setAttribute("onclick", "minWin(" + count + ")");
      return;
    }
  }
  var tbi = document.createElement("div");
  tbi.className = "taskbaritem";
  var iconEl = document.createElement("div");
  iconEl.setAttribute("class", "taskbaricon borderCol " + (stickied ? "stickied" : ""));
  iconEl.setAttribute("id", count);
  iconEl.setAttribute("type", id);
  iconEl.setAttribute("activelevel", actLvl);
  iconEl.setAttribute("onclick", actLvl == 2 ? "minWin(" + count + ")" : "selectIcon(event," + id + ",true)");
  iconEl.innerHTML = "<div class='icon'></div>";
  iconEl.addEventListener("mousedown", function (event) { showContext(event, id < errID || isCustomApp(id) ? (id == viewerID || id == consoleID ? 4 : 1) : 4) });
  setIcon(icon, iconEl.getElementsByClassName("icon")[0]);
  tbi.setAttribute("data-title", name);
  tbi.appendChild(iconEl);
  if (!stickied) {
    document.getElementById("taskbar").appendChild(tbi);
  } else {
    // Insert before the first unpinned item. The reference must be the item (a child of
    // the taskbar), not its icon, or insertBefore throws whenever a window is open.
    var after = elems[taskArr.length + permaStickied];
    document.getElementById("taskbar").insertBefore(tbi, after ? after.parentElement : null);
  }
}

function isStickied(id) {
  for (var i = 0; i < taskArr.length; i++) {
    if (taskArr[i] == id) { return i; }
  }
  return -1;
}

function press(evt, rez) {
  if (getParent(evt.target, "window").getAttribute("type") != "settings") { document.getElementById("clockbar").style.display = "none"; }
  var id = getParent(evt.target, "window").id;
  selWin = id;
  xStart = evt.clientX;
  yStart = evt.clientY;
  document.body.classList.add("scaling");
  moveToTop(id);
  resize = rez;
  if (resize) {
    attr = evt.target.getAttribute("scale");
  }
  select = false;
  clicked = true;
  hideSearch();
  document.getElementById("context").style.display = "none";
  evt.stopPropagation();
}

function release(event) {
  document.body.classList.remove("scaling");
  if (clicked && !preventEvents) {
    var win = windows[selWin];
    var edit = win.edit;
    if (resize) {
      win.sizeX[edit] = Math.max(win.sizeX[edit], 20);
      win.sizeY[edit] = Math.max(win.sizeY[edit], 15);
      /*var mult=attr.includes("l")?-1:1;
      if (attr.includes("w")){windows[selWin].sizeX[edit]=Math.max(windows[selWin].sizeX[edit]+((event.clientX-xStart)*mult/window.innerWidth*100),20);}
      if (attr.includes("h")){windows[selWin].sizeY[edit]=Math.max(windows[selWin].sizeY[edit]+((event.clientY-yStart)/window.innerWidth*100),15);}
      if (mult==-1){
        windows[selWin].xPos[edit]+=(evt.clientX-xStart);
      }*/
    } else {
      if (setFullscreen > 0) {
        edit = (setFullscreen == 1 ? 1 : 0);
        win.edit = edit;
        win.xPos[edit] = setFullscreen < 3 ? 0 : window.innerWidth / 2;
        win.yPos[edit] = 0;
        win.sizeX[edit] = (setFullscreen == 1 ? 100 : 50);
        win.sizeY[edit] = window.innerHeight / window.innerWidth * 100 - (lockTaskbar ? 3 : 0);
        var elem = document.getElementsByClassName("window")[selWin].style;
        elem.left = setFullscreen < 3 ? 0 : "50em";
        elem.top = 0;
        elem.width = setFullscreen == 1 ? "100em" : "50em";
        elem.height = win.sizeY[edit] + "em";
        elem.transition = "100ms";
        setTimeout(function () { elem.transition = "none"; }, 100);
        document.getElementById("shadow").style.opacity = 0;
        setFullscreen = 0;
      } else {
        win.xPos[edit] += (event.clientX - xStart);
        win.yPos[edit] += (event.clientY - yStart);
      }
    }
    clicked = false;
  }
  select = false;
  document.getElementById("selectbox").style = "display:none";
}

function moveWindow(evt) {
  if (clicked && !preventEvents) {
    var elem = document.getElementsByClassName("window")[selWin];
    var sW = windows[selWin];
    if (resize) {
      var edit = sW.edit;
      //windows[selWin].sizeX[edit]
      var multL = attr.includes("l") ? -1 : 1;
      var multT = attr.includes("t") ? -1 : 1;
      if (attr.includes("w")) {
        sW.sizeX[edit] = (sW.sizeX[edit] + (evt.clientX - xStart) / window.innerWidth * 100 * multL);
        elem.style.width = sW.sizeX[edit] + "em";
      }
      if (attr.includes("h")) {
        sW.sizeY[edit] = (sW.sizeY[edit] + (evt.clientY - yStart) / window.innerWidth * 100 * multT);
        elem.style.height = sW.sizeY[edit] + "em";
      }
      if (multL == -1) {
        var offs = sW.sizeX[edit] > 20 ? 0 : (20 - sW.sizeX[edit]) / 100 * window.innerWidth;
        sW.xPos[edit] = event.clientX - offs;
        elem.style.left = sW.xPos[edit] + "px";
      }
      if (multT == -1) {
        var offs = sW.sizeY[edit] > 15 ? 0 : (15 - sW.sizeY[edit]) / 100 * window.innerWidth;
        sW.yPos[edit] = event.clientY - offs;
        elem.style.top = sW.yPos[edit] + "px";
      }
      xStart = evt.clientX;
      yStart = evt.clientY;
    } else {
      elem.style.left = (sW.xPos[sW.edit] + evt.clientX - xStart) + "px";
      elem.style.top = (sW.yPos[sW.edit] + evt.clientY - yStart) + "px";
      if (elem.getAttribute("type") != "error" && elem.getAttribute("type") != "settings") {
        if (sW.edit == 1 && sW.xPos[sW.edit] == 0 && sW.sizeX[sW.edit] == 100 && evt.clientY - yStart >= window.innerHeight / 100) {
          sW.edit = 0;
          var sPerc = evt.clientX / window.innerWidth;
          var el = document.getElementsByClassName("window")[selWin];
          el.style.width = sW.sizeX[0] + "em";
          el.style.height = sW.sizeY[0] + "em";
          sW.xPos[0] = evt.clientX - (sW.sizeX[0] / 100 * window.innerWidth) * sPerc;
          sW.yPos[0] = evt.clientY - 0.0125 * window.innerWidth;
          el.style.left = sW.xPos[0] + "px";
          el.style.top = sW.yPos[0] + "px";
          el.style.transition = "50ms";
          setTimeout(function () { el.style.transition = "none"; }, 50);
          var shadow = document.getElementById("shadow").style;
        } else if (evt.clientY <= window.innerWidth / 100) {
          document.getElementById("shadow").style = "opacity:1; width:100%; left:0";
          setFullscreen = 1;
        } else if (evt.clientX <= window.innerWidth / 100) {
          document.getElementById("shadow").style = "opacity:1; width:50%; left:0";
          setFullscreen = 2;
        } else if (evt.clientX >= window.innerWidth / 100 * 99) {
          document.getElementById("shadow").style = "opacity:1; width:50%; left:50%";
          setFullscreen = 3;
        } else {
          document.getElementById("shadow").style.opacity = "0";
          setFullscreen = 0;
        }
        var shadow = document.getElementById("shadow");
        shadow.style.height = "100%";
        shadow.style.paddingBottom = (lockTaskbar ? "0" : "3em");
      }
    }
  } else if (select && !preventEvents) {
    var w = Math.abs(evt.clientX - xStart), h = Math.abs(evt.clientY - yStart);
    var x = (evt.clientX - xStart > 0) ? xStart : evt.clientX, y = (evt.clientY - yStart > 0) ? yStart : evt.clientY;
    document.getElementById("selectbox").style = "display:block; left:" + x + "px; top:" + y + "px; width:" + w + "px; height:" + h + "px";

    var elem = document.getElementsByClassName("desktoplink");
    var iconData = [];
    var iW = window.innerWidth * 0.05, iH = window.innerWidth * 0.06;
    for (var i = 0; i < elem.length; i++) {
      elem[i].setAttribute("selected", false);
      var rect = elem[i].getBoundingClientRect();
      iconData.push({
        x: rect.left,
        y: rect.top
      });
    }
    //document.getElementById("test").innerHTML=x+","+y+","+w+","+h;
    for (var h2 = 0; h2 <= 30; h2++) {
      for (var w2 = 0; w2 <= 30; w2++) {
        var x2 = x + w / 30 * w2, y2 = y + h / 30 * h2;
        for (var i = 0; i < elem.length; i++) {
          if (x2 >= iconData[i].x && x2 <= iconData[i].x + iW && y2 >= iconData[i].y && y2 <= iconData[i].y + iH) {
            elem[i].setAttribute("selected", true);
          }
        }
      }
    }
  }

  //taskbar stuff
  if (evt.clientY > window.innerHeight - window.innerWidth / 100 || document.getElementById("taskbar").style.bottom == "0" && evt.clientY > window.innerHeight - window.innerWidth * 0.03) {
    hide = false;
  } else if (evt.clientY < window.innerHeight - window.innerWidth * 0.03) {
    hide = true;
  }
}

function closeWin(id) {
  var actWin = document.getElementsByClassName("window")[id];
  actWin.classList.add("closed");
  setTimeout(function () { closeWinHelper(id, actWin); }, 200);
}

function closeWinHelper(id, actWin) {
  actWin.getElementsByClassName("content")[0].innerHTML = "<iframe id='frame'></iframe>";
  actWin.setAttribute("type", null)
  setTimeout(function () { actWin.style.display = "none" }, 500);

  var icons = document.getElementsByClassName("taskbaricon");
  for (var i = 0; i < icons.length; i++) {
    if (icons[i].id == id) {
      if (icons[i].classList.contains("stickied")) {
        icons[i].id = "null";
        icons[i].setAttribute("activelevel", 0);
        icons[i].setAttribute("onclick", "selectIcon(event," + icons[i].getAttribute("type") + ",true)");
        for (var n = i + 1; n < icons.length; n++) {
          if (icons[n].getAttribute("type") == icons[i].getAttribute("type")) {
            icons[i].id = icons[n].id;
            icons[n].id = "null";
            icons[n].setAttribute("type", "null");
            icons[n].style.opacity = "0";
            //setTimeout(function(){icons[n].style.display="none"; findTopWin();},200);
            icons[i].setAttribute("onclick", "minWin(" + icons[i].id + ")");
            setTimeout(function () { icons[n].parentElement.parentElement.removeChild(icons[n].parentElement); findTopWin(); }, 200);
            clicked = false;
            return;
          }
        }
      } else {
        icons[i].style.opacity = "0";
        setTimeout(function () { icons[i].parentElement.parentElement.removeChild(icons[i].parentElement); findTopWin(); }, 200);
        clicked = false;
        return;
      }
    }
  }
  //actWin.parentElement.removeChild(actWin);
  findTopWin();
  clicked = false;
  select = false;
}

function reloadWin(id) {
  var srcEl = document.getElementsByTagName("iframe")[id];
  var src = srcEl.src;
  srcEl.src = src;
  clicked = false;
  select = false;
}

function toggle(id) {
  windows[id].edit = Math.abs(windows[id].edit - 1);
  var elem = document.getElementsByClassName("window")[id];
  var edit = windows[id].edit;
  elem.style.width = windows[id].sizeX[edit] + "em";
  windows[id].sizeY[1] = window.innerHeight / window.innerWidth * 100 - (lockTaskbar ? 3 : 0);
  elem.style.height = windows[id].sizeY[edit] + "em";
  elem.style.left = windows[id].xPos[edit] + "px";
  elem.style.top = windows[id].yPos[edit] + "px";
  moveToTop(id);
  findTopWin();
  elem.style.transition = "100ms";
  setTimeout(function () { elem.style.transition = "none"; }, 100);
}

function minWin(id) {
  if (document.getElementsByClassName("window")[id].getAttribute("active") == "true" || windows[id].collapsed) {
    windows[id].collapsed = !windows[id].collapsed;
  }
  moveToTop(id);
  findTopWin();
}

function findTopWin() {
  //alert("GOT HERE!");
  var max = -10, maxId = -1;
  var wins = document.getElementsByClassName("window");
  for (var i in windows) {
    if (!wins[i].classList.contains("closed") && windows[i].z > max) {
      max = windows[i].z;
      maxId = i;
    }
  }
  if (maxId > -1) { wins[maxId].setAttribute("active", true); }
  var elems = document.getElementsByClassName("taskbaricon");
  for (var i = 0; i < elems.length; i++) {
    if (elems[i].getAttribute("activelevel") == 2) { elems[i].setAttribute("activelevel", 1); }
    if (elems[i].id == maxId) { elems[i].setAttribute("activelevel", 2); }
  }
}

function moveToTop(id) {
  var max = 0;
  var wins = document.getElementsByClassName("window");
  for (var i = 0; i < windows.length; i++) {
    if (windows[i].z > max) { max = windows[i].z; }
    wins[i].setAttribute("active", false);
  }
  if (max != windows[id].z) {
    wins[id].style.zIndex = max + 1;
    windows[id].z = max + 1;
  }
  wins[id].setAttribute("active", true);

  var collapsed = windows[id].collapsed;
  var elem = document.getElementsByClassName("window")[id];
  if (collapsed) {
    elem.classList.add("closed");
  } else {
    elem.classList.remove("closed");
  }
  //elem.style.display=collapsed?"none":"block";
  elem = document.getElementsByClassName("taskbaricon");
  for (var i = 0; i < elem.length; i++) {
    elem[i].setAttribute("activelevel", elem[i].getAttribute("activelevel") == 0 ? 0 : 1);
    if (elem[i].id == id) {
      elem[i].setAttribute("activelevel", (collapsed ? 1 : 2));
    }
  }
}

function selectIcon(evt, id, singleClick) {
  hideSearch();
  if (programData[id] && programData[id].removed) { return; }
  if (!preventEvents) {
    var time = new Date().getTime();
    if (time - last < 500 || singleClick) {
      if (id == setID) { openSettings(); } else if (id == chatID) { openChat(); } else { addWindow(id, null, null, DEF_WIN_W, DEF_WIN_H); }
      prevX = -100;
    } else if (evt.target.getAttribute("class") == "ddesc" && time - last < 1000) {
      editName(id);
      preventEvents = true;
    }
    last = time;
  }
  document.getElementById("context").style.display = "none";
}

function editName(id) {
  var link = desktopLink(id);
  if (!link) { return; }
  var p = link.getElementsByClassName("ddesc")[0];
  var name = p.innerHTML;
  p.innerHTML = "<div contenteditable spellcheck='false' id='nameedit'>" + escapeHtml(name) + "</div>";
  var ne = document.getElementById("nameedit");
  selectElementContents(ne);
  ne.addEventListener("keydown", function (event) { setName(event, id) });
}

//http://stackoverflow.com/a/6150060
function selectElementContents(el) {
  var range = document.createRange();
  range.selectNodeContents(el);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function setName(evt, id) {
  var elem = document.getElementById("nameedit");
  if (evt.keyCode == 13) {
    var oldName = programData[id].name;
    var name = elem.textContent.trim();
    for (var i = 0; i < programData.length; i++) {
      var boolName = (programData[i].name == name && name != oldName), boolBlank = (name == "");
      if (boolName || boolBlank) {
        if (boolName) { openPopup("Filename Error", "Error: Filename '" + name + "' is already in use. Try another name."); }
        if (boolBlank) { openPopup("Filename Error", "Error: Filename cannot be blank. Try another name."); }
        elem.parentElement.textContent = oldName;
        preventEvents = false;
        return;
      }
    }
    elem.parentElement.parentElement.title = name;
    elem.parentElement.textContent = name;
    preventEvents = false;
    programData[id].name = name;
    var titles = document.getElementsByClassName("wintitle");
    var items = document.getElementsByClassName("taskbaritem");
    for (var i = 0; i < titles.length; i++) {
      if (titles[i].textContent == oldName) {
        titles[i].textContent = name;
      }
    }
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute("data-title") == oldName) {
        items[i].setAttribute("data-title", name);
      }
    }
    if (isCustomApp(id)) {
      // A custom app keeps its name in its own record; its letter icon follows the name.
      var list = readCustomApps();
      var slot = Number(id) - builtinCount;
      if (list[slot]) { list[slot].name = name; writeCustomApps(list); }
      programData[id].icon.letter = name.charAt(0).toUpperCase();
      var link = desktopLink(id);
      if (link) { setIcon(programData[id].icon, link.getElementsByClassName("icon")[0]); }
    } else {
      SnStore.set("customTitle" + id, name);
    }
  }
}

function resetNames() {
  var icons = document.getElementsByClassName("taskbaritem");
  var titles = document.getElementsByClassName("wintitle");
  for (var i = 0; i < titles.length; i++) {
    for (var n = 0; n < origNames.length; n++) {
      if (titles[i].textContent == programData[n].name) { titles[i].textContent = origNames[n]; }
    }
  }
  // Built-in apps only: custom apps have no original name to go back to.
  for (var i = 0; i < icons.length; i++) {
    var type = Number(icons[i].firstChild && icons[i].firstChild.getAttribute("type"));
    if (type >= 0 && type < origNames.length) { icons[i].setAttribute("data-title", origNames[type]); }
  }
  for (var i = 0; i < origNames.length; i++) {
    var link = desktopLink(i);
    if (link) {
      link.title = origNames[i];
      link.getElementsByClassName("ddesc")[0].textContent = origNames[i];
    }
    SnStore.remove("customTitle" + i);
  }
  for (var n = 0; n < origNames.length; n++) {
    programData[n].name = origNames[n];
  }
}

function openPopup(errtitle, errStr, icon) {
  icon = icon || "err";
  programData[errID].icon.svg = icon + "_icon";
  addWindow(errID, errtitle, errStr, 25, 9);
}

function showSearchFull(evt) {
  if (document.getElementById("search").value == "") { document.getElementById("innerbar").innerHTML = document.getElementById("resultsbuffer").innerHTML; }
  document.getElementById("searchbarbar").setAttribute("expanded", false);
  document.getElementById("sbblabel").innerHTML = "<b>SEARCH</b>";
  document.getElementById("search").setAttribute("active", true);
  var search = document.getElementById("searchbar").style;
  search.width = "27.5em";
  search.height = "50em";
  var buttons = document.getElementsByClassName("sbbitem2");
  buttons[0].style.bottom = "0";
  buttons[1].style.display = "none";
  document.getElementsByClassName("sbbitem")[1].style.display = "block";
  if (!expanded) {
    showSearch(evt);
  }
  preventHide = true;
  evt.stopPropagation();
}

function showSearch(evt) {
  expanded = true;
  document.getElementById("searchbar").style.opacity = "1";
  document.getElementById("searchbar").style.bottom = "3em";
  document.getElementById("context").style.display = "none";
  document.getElementById("powerbar").style.display = "none";
  evt.stopPropagation();
}

function showHome(evt) {
  document.getElementById("searchbarbar").setAttribute("expanded", false);
  document.getElementById("innerbar").innerHTML = "";
  document.getElementById("sbblabel").innerHTML = "<b>HOME</b>";
  document.getElementById("search").setAttribute("active", false);
  document.getElementById("search").value = "";
  var buttons = document.getElementsByClassName("sbbitem2");
  buttons[0].style.bottom = "3.5em";
  buttons[1].style.display = "block";
  document.getElementsByClassName("sbbitem")[1].style.display = "none";
  var elem = document.getElementById("searchbar").style;
  if (!expanded) {
    showSearch(evt);
  } else if (elem.width == "57.5em") {  //Dirty, but it works.
    document.getElementById("searchbar").style = "opacity:0; bottom:-100vh";
    expanded = false;
  }
  elem.width = "57.5em";
  elem.height = "30em";
  setTimeout(function () {
    document.getElementById("innerbar").innerHTML = document.getElementById("mainbuffer").innerHTML;
    var tot = 0, max = 5;
    var pb = document.getElementById("puzzlebar");
    var imgs = [1084, 1078, 1072, 1067, 1057, 1050, 1048, 1043, 1040, 1039, 1033, 1030, 1025, 1018, 1016, 998, 995, 980, 979, 972, 967, 953, 939, 929, 900, 899, 893, 867, 862, 857, 835, 807, 789, 744, 724, 701];
    var backUrl = "https://unsplash.it/800/800?image=" + imgs[Math.floor(Math.random() * imgs.length)];
    for (var i = 0; i < 25; i++) {
      var piece = document.createElement("div");
      piece.className = "puzzle specColor";
      var wide = Math.random() > 0.6 && tot % max < 4;
      piece.setAttribute("wide", wide);
      //piece.innerHTML="Test "+(i+1);
      piece.style.backgroundImage = "url(" + backUrl + ")";
      piece.style.backgroundPosition = (-7.5 * (tot % max)) + "em " + (-7.5 * Math.floor(tot / max)) + "em";
      tot += (wide ? 2 : 1);
      pb.insertBefore(piece, pb.lastChild.previousSibling);
      if (tot == 25) { break; }
    }
    fillHome();
    var pieces = document.getElementById("innerbar").getElementsByClassName("puzzle");
    for (var i = 0; i < pieces.length; i++) {
      pieces[i].addEventListener("mousedown", function (event) { selectPiece(event); });
      pieces[i].addEventListener("mousemove", function (event) { slidePiece(event); });
      pieces[i].addEventListener("mouseup", function (event) { placePiece(event); });
    }
  }, 200);
  preventHide = true;
  evt.stopPropagation();
}

function selectPiece(evt) {
  var pieces = document.getElementById("innerbar").getElementsByClassName("puzzle");
  var sel = 0, max = pieces.length - 1;
  var preBox = document.getElementById("puzzlebar").getBoundingClientRect(), preBox2;
  for (var i = 0; i < pieces.length; i++) {
    if (pieces[i] == evt.target) { sel = i; }
  }
  preBox2 = pieces[sel].getBoundingClientRect();
  var box = {
    t: preBox2.top - preBox.top,
    l: preBox2.left - preBox.left,
    w: preBox2.width,
    h: preBox2.height
  };
  //Had to hardcopy the css... Sorry for that.
  pieces[max].setAttribute("style", pieces[sel].getAttribute("style"));
  pieces[sel].classList.add("ghost");
  pieces[max].setAttribute("wide", pieces[sel].getAttribute("wide"));
  pieces[max].innerHTML = pieces[sel].innerHTML;
  var sh = document.getElementById("puzzlebar").scrollTop;
  pieces[max].style.display = "block";
  pieces[max].style.position = "absolute";
  pieces[max].style.marginLeft = (evt.clientX - preBox.left - box.w / 2) + "px";
  pieces[max].style.marginTop = (evt.clientY - preBox.top - box.h / 2 + sh) + "px";
  slide = true;
}

function slidePiece(evt) {
  if (slide) {
    var pieces = document.getElementById("innerbar").getElementsByClassName("puzzle");
    var count = 0;
    for (var i = 0; i < pieces.length - 1; i++) {
      count += (pieces[i].getAttribute("wide") == "true" ? 2 : 1);
      if (count == 5) {
        count = 0;
      } else if (count == 6) {
        var elem = document.createElement("div");
        elem.className = "puzzle invisible";
        elem.setAttribute("wide", "false");
        pieces[i].parentElement.insertBefore(elem, pieces[i]);
        count = 0;
      }
    }
    var max = pieces.length - 1;
    var container = document.getElementById("puzzlebar");
    var box = container.getBoundingClientRect();
    var sh = container.scrollTop;
    var box2 = pieces[max].getBoundingClientRect();
    pieces[max].style.marginLeft = (evt.clientX - box.left - box2.width / 2) + "px";
    pieces[max].style.marginTop = (evt.clientY - box.top - box2.height / 2 + sh) + "px";
    var ghost = container.getElementsByClassName("ghost")[0];

    for (var i = 0; i < max; i++) {
      var rect = pieces[i].getBoundingClientRect();
      if (evt.clientX > rect.left && evt.clientY > rect.top && evt.clientX < rect.left + Math.min(rect.width, ghost.getBoundingClientRect().width) && evt.clientY < rect.top + rect.height && pieces[i] != ghost) {
        var pe = ghost.parentElement;
        pe.removeChild(ghost);
        pe.insertBefore(ghost, pieces[i]);
        break;
      }
    }
    var tmpElem = document.getElementById("innerbar").getElementsByClassName("invisible");
    for (var i = 0; i < tmpElem.length; i++) {
      if (tmpElem[i + 1] != ghost) {
        tmpElem[i].parentElement.removeChild(tmpElem[i]);
      }
    }
  }
}

function placePiece() {
  var pieces = document.getElementById("innerbar").getElementsByClassName("puzzle");
  var ghost = document.getElementById("innerbar").getElementsByClassName("ghost")[0];
  if (ghost) {
    ghost.classList.remove("ghost");
  }
  pieces[pieces.length - 1].style.display = "none";
  var invisible = document.getElementById("innerbar").getElementsByClassName("invisible");
  for (var i = 0; i < invisible.length; i++) {
    invisible[i].parentElement.removeChild(invisible[i]);
  }
  slide = false;
}

function fillHome() {
  var output = "";
  searchFor = -1;
  var locData = [];
  desktopAppIds().forEach(function (id) {
    var app = programData[id];
    app.index = id;
    app.oftenUsed = oftenUsed[id];
    locData.push(app);
  });
  for (var i = 0; i < locData.length; i++) {
    for (var j = i + 1; j < locData.length; j++) {
      if (locData[i].oftenUsed < locData[j].oftenUsed) {
        var tmpR = locData[i];
        locData[i] = locData[j];
        locData[j] = tmpR;
      }
    }
  }

  var addTo = document.getElementById("programbar");
  addTo.innerHTML = "";

  if (locData[0].oftenUsed > 0) {
    addSpacer(addTo, "Often used");
    for (var i = 0; i < 6; i++) {
      if (locData[i].oftenUsed == 0) { break; }
      addPbItem(addTo, locData[i].index, locData[i].icon, locData[i].name, locData[i].oftenUsed)
    }
    addSpacer(addTo, "");
  }

  for (var i = 0; i < locData.length; i++) {
    for (var j = i + 1; j < locData.length; j++) {
      if (locData[i].name.localeCompare(locData[j].name) > 0) {
        var tmpR = locData[i];
        locData[i] = locData[j];
        locData[j] = tmpR;
      }
    }
  }
  for (var i = 0; i < locData.length; i++) {
    var name = locData[i].name;
    var cc = name.charCodeAt(0);
    if (cc >= 97 && cc <= 122) { cc -= 32; }
    if (searchFor == -1) {
      if (cc < 65 || cc > 90) {
        addSpacer(addTo, "#");
        searchFor = 64;
      }
    }
    if (cc > searchFor && cc >= 65 && cc <= 90) {
      addSpacer(addTo, String.fromCharCode(cc));
      searchFor = cc;
    }
    addPbItem(addTo, locData[i].index, locData[i].icon, locData[i].name, null);
  }
}

function addPbItem(addTo, index, icon, name, used) {
  var pbitem = document.createElement("div");
  pbitem.className = "pbitem";
  pbitem.setAttribute("onclick", "selectIcon(event," + index + ",true)");
  var pbicon = document.createElement("div");
  pbicon.className = "icon";
  var pbtitle = document.createElement("div");
  pbtitle.className = "pbtitle";
  pbtitle.innerHTML = escapeHtml(name) + " " + (used != null ? "<span>(" + used + ")</span>" : "");

  pbitem.appendChild(pbicon);
  pbitem.appendChild(pbtitle);
  addTo.appendChild(pbitem);

  setIcon(icon, pbicon);
}

function addSpacer(addTo, msg) {
  var spacer = document.createElement("div");
  spacer.className = "pbspacer";
  spacer.innerHTML = msg;
  addTo.appendChild(spacer);
}

function hideSearch() {
  expanded = false;
  var elem = document.getElementById("searchbar").style;
  elem.opacity = "0";
  elem.bottom = "-100vh";
  var elem = document.getElementById("search");
  elem.value = "";
  elem.setAttribute("active", false);
}

function sbbToggle(elem) {
  elem = elem.parentElement;
  elem.setAttribute("expanded", elem.getAttribute("expanded") == "false");
}

function sbbHome() {
  document.getElementById("searchbarbar").setAttribute("expanded", false);
  document.getElementById("search").value = "";
  document.getElementById("innerbar").innerHTML = document.getElementById("resultsbuffer").innerHTML;
}

function togglePower() {
  var powerbar = document.getElementById("powerbar").style;
  powerbar.display = powerbar.display == "block" ? "none" : "block";
}

function restart() {
  var elem = document.getElementById("loadscreen");
  elem.innerHTML = document.getElementById("loadscreenbuffer").innerHTML;
  elem.getElementsByClassName("loadmsg")[0].innerHTML = "Shutting down";
  elem.style = "display:flex; opacity:0; animation:fadescreen 3500ms forwards 1; animation-delay:250ms;";
  setTimeout(function () { elem.style.backgroundColor = "black"; elem.innerHTML = "" }, 3750);
  setTimeout(function () { location.reload(); }, 4000);
}

function powerOff(evt) {
  preventHide = false;
  openPopup("Nope.", "You fool! You can't exit SnOS. SnOS is love. SnOS is life.");
  hideSearch();
  evt.stopPropagation();
}

// Names come from saved settings (user-renamed apps) and from remote APIs, so they
// must never be interpreted as markup.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function search() {
  // The query is plain text, not a pattern: typing "(" or "[" must not throw.
  var input = new RegExp(escapeRegExp(document.getElementById("search").value), "gi");
  var results = [];
  var ids = desktopAppIds();
  for (var k = 0; k < ids.length; k++) {
    var i = ids[k];
    var arr = programData[i].keywords.split(",");
    var newArr = [];
    for (var n = 0; n < arr.length; n++) {
      if (arr[n].match(input) != null || programData[i].name.match(input) != null) {
        newArr.push(arr[n]);
      }
    }
    if (newArr.length > 0) {
      var keyws = newArr.toString().replace(/,/g, ", ");
      results.push({
        index: i,
        name: programData[i].name,
        keywords: keyws.match(input) == null ? keyws : keyws.replace(input, "<span class='highlight'>" + keyws.match(input)[0] + "</span>"),
        url: programData[i].url,
        icon: programData[i].icon
      });
    }
  }
  for (var i = 0; i < results.length; i++) {
    for (var j = i + 1; j < results.length; j++) {
      if (results[i].name.localeCompare(results[j].name) > 0) {
        var tmpR = results[i];
        results[i] = results[j];
        results[j] = tmpR;
      }
    }
  }

  var addTo = document.getElementById("innerresults");
  addTo.innerHTML = "";

  for (var i = 0; i < results.length; i++) {
    var tmpUrl = results[i].url;
    //inHTML+="<a class='result' onclick='window.open('"+(tmpUrl.includes("aquaplexus")?tmpUrl.replace("https","http"):tmpUrl)+"')'><div class='resultimg'></div><div class='resulttext'>"+results[i].name+"<br><kw>"+results[i].keywords+"</kw></div></a>"
    addResult(addTo, results[i].index, results[i].icon, results[i].name, results[i].keywords);
  }

  if (results.length == 0) {
    addTo.innerHTML = "<div id='searchmsg' style='color:#999; text-align:center'><br><br>No results.</div>"
  }
}

function addResult(addTo, index, icon, name, keywords) {
  var result = document.createElement("a");
  result.className = "result";
  result.addEventListener("click", function (event) { selectIcon(event, index, true); });
  var resultimg = document.createElement("div");
  resultimg.className = "resultimg";
  var resulttext = document.createElement("div");
  resulttext.className = "resulttext";
  resulttext.innerHTML = escapeHtml(name) + "<br><kw>" + keywords + "</kw>";

  result.appendChild(resultimg);
  result.appendChild(resulttext);
  addTo.appendChild(result);
  setIcon(icon, resultimg);
}

//So many edge cases...
//I'm sorry for this.
function showContext(evt, type) {
  if (evt.which != 1) {
    var items = document.getElementsByClassName("contextitem");
    var context = document.getElementById("context");
    for (var i = 0; i < items.length; i++) {
      items[i].style.display = "none";
    }
    for (var i = 0; i < contextAssort[type].length; i++) {
      items[contextAssort[type][i]].style.display = "block";
    }

    if (type == 0) {
      var tot = 0;
      var id = -1, elem = document.getElementsByClassName("desktoplink");
      var targ = getParent(evt.target, "desktoplink");
      if (targ) { id = Number(targ.getAttribute("data-app")); }
      for (var i = 0; i < elem.length; i++) {
        if (elem[i].getAttribute("selected") == "true") {
          tot++;
        }
      }
      document.getElementsByClassName("contextitem")[1].style.display = tot > 1 && id != -1 ? "block" : "none";
      document.getElementsByClassName("contextitem")[1].innerHTML = "Open All (" + tot + ")";
      items[17].style.display = isCustomApp(id) ? "block" : "none";
      context.setAttribute("target", id);
      for (var i = 0; i < elem.length; i++) {
        if (elem[i] == evt.target) {
          context.setAttribute("targetIndex", i);
        }
      }
    } else if (type == 1 || type == 4 || type == 5) {
      var icons = document.getElementsByClassName("taskbaricon");
      for (var i = 0; i < icons.length; i++) {
        if (evt.target == icons[i]) {
          var stickied = icons[i].classList.contains("stickied");
          items[stickied ? 4 : 5].style.display = "none";
          items[6].innerHTML = "Open " + (stickied && icons[i].getAttribute("activelevel") == 0 ? "" : "new");
          //remove "open new" for error messages and settings
          var tgt = evt.target.getAttribute("type");
          if (type == 4 && (tgt == errID || tgt == setID || tgt == chatID)) {
            items[6].style.display = "none";
          }
          items[7].style.display = icons[i].id == "null" ? "none" : "block";
        }
      }
      context.setAttribute("target", evt.target.getAttribute("type"));
      for (var i = 0; i < icons.length; i++) {
        if (icons[i] == evt.target) {
          context.setAttribute("targetIndex", i);
        }
      }
    } else if (type == 2) {
      if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        items[8].innerHTML = "Go fullscreen";
      } else {
        items[8].innerHTML = "Exit fullscreen";
      }
      items[9].innerHTML = (contextShow ? "Disable" : "Enable") + " context menu";
    } else if (type == 3) {
      items[11].setAttribute("ticked", lockTaskbar);
      items[12].setAttribute("ticked", lockTaskbah);
    } else if (type == 6) {
      var file = getParent(evt.target, "file");
      if (file == null || file.classList.contains("tableheader")) { return; }
      context.setAttribute("target", getParent(evt.target, "window").id);
      var files = file.parentElement.getElementsByClassName("file");
      for (var i = 0; i < files.length; i++) {
        if (file == files[i]) { context.setAttribute("targetIndex", i); break; }
      }
      if (!getParent(evt.target, "file").classList.contains("html")) {
        items[16].style.display = "none";
      }
      evt.stopPropagation();
    }

    //Edit context menu styling (width,height,position)
    context.style.display = "block";
    context.style.left = ((evt.clientX + context.offsetWidth < window.innerWidth - window.innerWidth * 0.03) ? (evt.clientX + 2) : (evt.clientX - context.offsetWidth - 2)) + "px";
    context.style.top = ((evt.clientY + context.offsetHeight < window.innerHeight - window.innerWidth * 0.03) ? (evt.clientY + 2) : (evt.clientY - context.offsetHeight - 2)) + "px";
    evt.stopPropagation();
    //preventHide=true;
  }
}

function contextOpen(evt, mult) {
  //mult = multiple windows
  if (!mult) {
    var elem = document.getElementById("context");
    addWindow(elem.getAttribute("target"), null, null, DEF_WIN_W, DEF_WIN_H);
    elem.style.display = "none";
  } else {
    var count = 0, ids = [];
    var elem = document.getElementsByClassName("desktoplink");
    for (var i = 0; i < elem.length; i++) {
      if (elem[i].getAttribute("selected") == "true") {
        ids.push(Number(elem[i].getAttribute("data-app")));
        setTimeout(function () { addWindow(ids[0], null, null, DEF_WIN_W, DEF_WIN_H); ids.splice(0, 1); }, 750 * count);
        count++;
      }
    }
    document.getElementById("context").style.display = "none";
  }
  evt.stopPropagation();
}

function contextClose() {
  document.getElementById("context").style.display = "none";
  var toClose = document.getElementsByClassName("taskbaricon")[document.getElementById("context").getAttribute("targetIndex")].id;
  closeWin(toClose);
}

function contextEdit(evt) {
  var elem = document.getElementById("context");
  editName(elem.getAttribute("target"));
  preventEvents = true;
  elem.style.display = "none";
}

function contextPin(type) {
  document.getElementById("context").style.display = "none";
  var id = document.getElementById("context").getAttribute("target");
  var index = document.getElementById("context").getAttribute("targetIndex");
  for (var i = 0; i < taskArr.length; i++) {
    if (id == taskArr[i]) { return; }
  }
  if (type == 0) { addTaskbarIcon(id, "null", 0, programData[id].name, programData[id].icon, true); }
  else if (index > taskArr.length) {
    var icon = document.getElementsByClassName("taskbaricon")[index];
    icon.style.opacity = "0";
    icon.parentElement.parentElement.removeChild(icon.parentElement);
    document.getElementById("taskbar").insertBefore(icon.parentElement, document.getElementsByClassName("taskbaritem")[taskArr.length + permaStickied]);
    icon.style.opacity = "1";
    icon.classList.add("stickied");
  }
  taskArr.push(id);
  saveTaskArr();
}

function contextUnpin() {
  document.getElementById("context").style.display = "none";
  var icons = document.getElementsByClassName("taskbaricon");
  var target = document.getElementById("context").getAttribute("target");
  for (var i = 0; i < icons.length; i++) {
    if (icons[i].getAttribute("type") == target) {
      var id = icons[i].id;
      if (id == "null") {
        icons[i].style.opacity = "0";
        setTimeout(function () { icons[i].parentElement.parentElement.removeChild(icons[i].parentElement); }, 200);
      } else {
        icons[i].classList.remove("stickied");
      }
      taskArr.splice(i - permaStickied, 1);
      break;
    }
  }
  saveTaskArr();
}

function contextAddWin(evt) {
  document.getElementById("context").style.display = "none";
  var target = document.getElementById("context").getAttribute("target");
  selectIcon(evt, target, true);
}

function toggleTaskbah() {
  lockTaskbah = !lockTaskbah;
  var elem = document.getElementById("taskbahSound");
  if (lockTaskbah) {
    elem.currentTime = 0;
    elem.play().catch(function () { });
  } else {
    elem.pause();
  }
}

function openSettings(section) {
  hideSearch();
  return addWindow(setID, null, section || null, 64, 40);
}

// The live chat: one window, opened from the taskbar or the start menu.
function openChat() {
  hideSearch();
  return addWindow(chatID, null, null, 58, 40);
}



function selCol(id) {
  colId = id;
  SnStore.set("colId", id);
  setCols();
}

function selIco(id) {
  backId = id;
  SnStore.set("backId", id);
  setCols();
}

function toggleClock() {
  var elem = document.getElementById("clockbar");
  if (elem.style.display == "none") { openClock(); }
  else { elem.style.display = "none"; preventHide = false; }
}

function openClock() {
  document.getElementById("clockbar").style.display = "flex";
  var dt = new Date((new Date().getTime()) + tzOffset * 60000);
  var year = dt.getFullYear(), dInMo = daysInMonth(dt.getMonth(), year);
  var elem = document.getElementById("calendar");
  var tCo = "<th>MON</th><th>TUE</th><th>WED</th><th>THU</th><th>FRI</th><th>SAT</th><th>SUN</th>";
  var startAt = (7 + new Date(year, dt.getMonth(), 1).getDay() - 1) % 7;
  var counter = -startAt + 1;
  for (var i = 0; i < 6; i++) {
    if (counter > dInMo) { break; }
    tCo += "<tr>";
    for (var n = 0; n < 7; n++) {
      if (counter < 1) {
        tCo += "<td inactive>" + (daysInMonth((12 + dt.getMonth() - 1) % 12, year) + counter) + "</td>";
      } else if (counter <= dInMo) {
        tCo += "<td " + (counter == dt.getDate() ? "today" : "") + ">" + counter + "</td>"
      } else {
        tCo += "<td inactive>" + (counter - dInMo) + "</td>"
      }
      counter++;
    }
    tCo += "</tr>";
  }
  document.getElementById("calendar").innerHTML = tCo;
  preventHide = true;
  //alert(daysInMonth(1,2017));
}

function daysInMonth(month, year) {
  return new Date(year, month + 1, 0).getDate();
}

function newTime() {
  var dt = new Date(Date.now() + Number(tzOffset) * 60000);
  var month = dt.getMonth() + 1, day = dt.getDate(), hour = dt.getHours(), minute = dt.getMinutes();
  document.getElementById("time").innerHTML = "" + (hour < 10 ? "0" + hour : hour) + ":" + (minute < 10 ? "0" + minute : minute) + "<br>" + dt.getFullYear() + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);

  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var suffix = "th";
  if (day < 10 || day > 20) {
    if (day % 10 == 1) { suffix = "st"; }
    else if (day % 10 == 2) { suffix = "nd"; }
    else if (day % 10 == 3) { suffix = "rd"; }
  }
  var dateStr = months[dt.getMonth()] + " " + day + "" + suffix + " " + dt.getFullYear();
  document.getElementById("clocklbl").innerHTML = dateStr;
  document.getElementById("time").setAttribute("data-title", dateStr);
  document.getElementById("hour").style = "transform:rotate(" + (hour / 12 * 360 + minute / 2) + "deg)";
  document.getElementById("minute").style = "transform:rotate(" + (minute * 6 + dt.getSeconds() / 10) + "deg)";
  document.getElementById("second").style = "transform:rotate(" + dt.getSeconds() * 6 + "deg)";
}

function handleTaskbar() {
  if (!lockTaskbar) {
    var tb = document.getElementById("taskbar").style;
    //console.log(tb.bottom);
    if (hide && tb.bottom == "0vw" && !preventHide) {
      setTimeout(function () { if (hide) { tb.bottom = "-2.8vw"; } }, 750);
    } else if (!hide && tb.bottom == "-2.8vw") {
      tb.bottom = "0vw";
    }
  }
}



// "local" or a whole number of hours from UTC. tzOffset is stored as minutes to
// add to the local time.
function setTimezone(value) {
  tzOffset = value === "local" ? 0 : Number(value) * 60 + new Date().getTimezoneOffset();
  SnStore.set("tzOffset", tzOffset);
  newTime();
}

function currentTimezone() {
  var offset = Number(tzOffset);
  if (!offset) { return "local"; }
  return String(Math.round((offset - new Date().getTimezoneOffset()) / 60));
}



function setWindowSize(width, height) {
  DEF_WIN_W = parseInt(width) || DEF_WIN_W;
  DEF_WIN_H = parseInt(height) || DEF_WIN_H;
  SnStore.set("winW", DEF_WIN_W);
  SnStore.set("winH", DEF_WIN_H);
}

// What the Settings window (an iframe on this origin) may do to the desktop.
window.SnOS = {
  schemes: colors.map(function (scheme) { return scheme.slice(0, 3); }),
  wallpapers: backgrounds,
  state: function () {
    return {
      scheme: colId,
      wallpaper: backId,
      customBackground: SnStore.get("backgroundUrl") || "",
      windowWidth: DEF_WIN_W,
      windowHeight: DEF_WIN_H,
      timezone: currentTimezone()
    };
  },
  setScheme: selCol,
  setWallpaper: selIco,
  setCustomBackground: function (url) {
    if (url) { SnStore.set("backgroundUrl", url); } else { SnStore.remove("backgroundUrl"); }
    setCols();
  },
  setWindowSize: setWindowSize,
  setTimezone: setTimezone,
  resetNames: resetNamesRelay,
  factoryReset: resetAll,
  restart: restart,
  addApp: addApp,
  openAddApp: openAddAppDialog
};

newTime();
setInterval(newTime, 1000);
setInterval(handleTaskbar, 50);
window.onload = function () {
  setTimeout(function () {
    document.getElementById("loadscreen").style.opacity = 0;
    setTimeout(function () { document.getElementById("loadscreen").style.display = "none"; }, 500);
  }, 1500);
};
/*setInterval(function(){
  document.getElementById("test").innerHTML=prevX+" - "+prevY;
},10);*/

function openPrompt(title, msg, action) {
  var audio = new Audio('/resources/media/sounds/Xp_Error.wav');
  var buttons = "<br><button class='promptbtn exec'>OK</button><button class='promptbtn cancel'>Cancel</button>";
  // Browsers refuse to autoplay before the first user gesture; that is fine.
  audio.play().catch(function () { });
  openPopup(title, msg + buttons);
  var elem = document.getElementById("desktop").lastChild;
  elem.getElementsByClassName("close")[0].setAttribute("onclick", "cancelPrompt(" + elem.id + ")");
  elem.getElementsByClassName("cancel")[0].setAttribute("onclick", "cancelPrompt(" + elem.id + ")");
  elem.getElementsByClassName("exec")[0].setAttribute("onclick", "execNext(" + elem.id + ")");
  next = action;
}

function showNotification(title, body) {
  // Check if the browser supports notifications
  if (!("Notification" in window)) {
      console.log("This browser does not support desktop notification");
  }

  // Check whether notification permissions have already been granted
  else if (Notification.permission === "granted") {
      // If it's okay let's create a notification
      var notification = new Notification(title, { body: body });
  }

  // Otherwise, we need to ask the user for permission
  else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(function (permission) {
          // If the user accepts, let's create a notification
          if (permission === "granted") {
              var notification = new Notification(title, { body: body });
          }
      });
  }
}

//showNotification('Hello', 'This is a test notification');

function execNext(id) {
  if (next == "reset") {
    // Sign out first, or the account would put everything back on the next start.
    // The account itself keeps its settings: this resets the browser, not the account.
    var signOut = window.SnAccount ? SnAccount.logout({ keepSettings: true }) : Promise.resolve();
    signOut.then(function () {
      SnStore.clear();
      restart();
    });
  } else if (next == "resetn") {
    resetNames();
  } else if (next == "removeapp") {
    removeApp(pendingRemoval);
    pendingRemoval = null;
  } else if (next == "welcome") {
    SnStore.set("welcome-popup", "false");
    closeWin(id);
  }

  cancelPrompt(id);
}

function cancelPrompt(id) {
  next = null;
  closeWin(id);
}

// ---------------------------------------------------------------------------
// Adding and removing custom apps
// ---------------------------------------------------------------------------

// Resolves to { id } or { error }. The content filter is asked first so a blocked
// site never lands on the desktop.
function addApp(name, address) {
  var url = SnResolve.toUrl(address);
  if (!url) { return Promise.resolve({ error: "Enter a web address, like example.com." }); }
  var list = readCustomApps();
  var live = list.filter(Boolean);
  if (live.length >= CUSTOM_APPS_MAX) {
    return Promise.resolve({ error: "You can add up to " + CUSTOM_APPS_MAX + " apps. Remove one first." });
  }
  for (var i = 0; i < live.length; i++) {
    if (SnResolve.toUrl(live[i].url) === url) { return Promise.resolve({ error: "That site is already on your desktop." }); }
  }
  return SnProxy.verdict(new URL(url).hostname).then(function (result) {
    if (result.blocked) { return { error: "That site is blocked by the content filter." }; }
    list = readCustomApps(); // may have changed while the filter was asked
    var base = cleanAppName(name) || new URL(url).hostname.replace(/^www\./, "");
    var unique = base, n = 2;
    while (programData.some(function (app) { return !app.removed && app.name === unique; })) {
      unique = base.slice(0, APP_NAME_MAX - 4) + " (" + n++ + ")";
    }
    var slot = list.indexOf(null);
    if (slot === -1) { slot = list.length; }
    list[slot] = { name: unique, url: url };
    writeCustomApps(list);
    var id = builtinCount + slot;
    programData[id] = customAppEntry(list[slot]);
    oftenUsed[id] = 0;
    addDesktopIcon(id);
    return { id: id };
  });
}

function removeApp(id) {
  id = Number(id);
  if (!isCustomApp(id) || !programData[id] || programData[id].removed) { return; }
  // Close its windows (closed windows stay in the page, typed "null").
  var wins = document.getElementsByClassName("window");
  for (var i = 0; i < wins.length; i++) {
    if (wins[i].getAttribute("type") == id && !wins[i].classList.contains("closed")) { closeWin(i); }
  }
  // Unpin it. closeWinHelper removes unpinned icons itself (about 400 ms after
  // closeWin) through a live list of icons, so only the pinned one is removed here, and
  // only once that has finished.
  taskArr = taskArr.filter(function (pinned) { return Number(pinned) !== id; });
  saveTaskArr();
  setTimeout(function () {
    var icon = document.querySelector(".taskbaricon.stickied[type='" + id + "']");
    if (icon) { icon.parentElement.remove(); }
  }, 700);
  var link = desktopLink(id);
  if (link) { link.remove(); }
  programData[id] = removedApp();
  oftenUsed[id] = 0;
  saveOftenUsed();
  var list = readCustomApps();
  list[id - builtinCount] = null;
  writeCustomApps(list);
}

var pendingRemoval = null;

function confirmRemoveApp(id) {
  if (!isCustomApp(id) || programData[id].removed) { return; }
  pendingRemoval = Number(id);
  openPrompt("Remove app?", "Remove " + escapeHtml(programData[id].name) + " from your desktop?", "removeapp");
}

// The "Add an app" window. Both fields can be filled in ahead (the Browser's
// "Add to desktop" does that).
function openAddAppDialog(name, address) {
  hideSearch();
  programData[errID].icon.svg = "info_icon";
  var win = addWindow(errID, "Add an app", "<form class='appform' novalidate>" +
    "<label>Web address<input name='url' autocomplete='off' spellcheck='false' placeholder='example.com'></label>" +
    "<label>Name<input name='name' autocomplete='off' maxlength='" + APP_NAME_MAX + "' placeholder='Optional'></label>" +
    "<p class='apperror' role='alert'></p>" +
    "<div class='appbuttons'><button class='promptbtn' type='submit'>Add</button><button class='promptbtn' type='button'>Cancel</button></div>" +
    "</form>", 27, 13);
  var form = win.getElementsByClassName("appform")[0];
  var error = form.getElementsByClassName("apperror")[0];
  var submit = form.querySelector("button[type='submit']");
  form.elements.url.value = address || "";
  form.elements.name.value = cleanAppName(name);
  form.querySelector("button[type='button']").addEventListener("click", function () { closeWin(Number(win.id)); });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    addApp(form.elements.name.value, form.elements.url.value).then(function (result) {
      submit.disabled = false;
      if (result.error) {
        error.textContent = result.error;
        form.elements.url.focus();
      } else {
        closeWin(Number(win.id));
      }
    });
  });
  setTimeout(function () { form.elements[address ? "name" : "url"].focus(); }, 250);
  return win;
}

function resetNamesRelay() {
  openPrompt("Reset Names?", "Do you want to reset all file names?", "resetn");
}

function resetAll() {
  openPrompt("Reset System?", "Do you want to reset the system?", "reset");
}

// Check if the user has visited before
if (!SnStore.get("visited-before")) {
  // This is the user's first visit
  setTimeout(function() {
    openPrompt("Welcome to SnOS!", "Do people even read this?? Don't you have school work to do? I KNOW your GPA is below a 3.0", "welcome");
  }, 3000);

  // Set the flag indicating the user has visited before
  SnStore.set("visited-before", "true");
}

function toggleFullscreen() {
  if (!document.fullscreenElement &&    // alternative standard method
    !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {  // current working methods
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

function moveHist(index, dir) {
  var w = windows[index], win = document.getElementsByClassName("window")[index];
  w.histPointer += dir * 2;
  win.getElementsByClassName("path")[0].value = w.history[w.histPointer + 1];
  //loadFiles(w.history[w.histPointer],win);
  //This will update everything that needs to be updated.
  parseGeneralURL(win, w.history[w.histPointer]);
}

// The repository list comes from GitHub's unauthenticated API (60 requests per
// hour per IP), so fetch it only when an Explorer window opens and only once.
var repoCache = null;

function loadRepos(wrapper) {
  function render(repos) {
    repos.forEach(function (repo) {
      var item = document.createElement("div");
      item.className = "sidelink";
      item.textContent = repo.name;
      item.addEventListener("click", function () { parseGeneralURL(item, repo.url + "/contents"); });
      wrapper.appendChild(item);
    });
  }

  if (repoCache) return render(repoCache);
  fetch("https://api.github.com/users/SuperNova-Network/repos")
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (repos) {
      repoCache = Array.isArray(repos) ? repos : [];
      render(repoCache);
    })
    .catch(function () { /* offline or rate limited: the sidebar simply stays empty */ });
}

function parseGeneralURL(elem, url) {
  var win = getParent(elem, "window");
  loadFiles(dirToUrl(win, url), win);
}

function dirToUrl(win, inp) {
  if (inp.includes("http")) {
    win.setAttribute("root", inp.split("/")[5]);   //The repo name is at this position in a https URL.
    return inp;
  }
  var inputArr = inp.split("\\");
  var url = "https://api.github.com/repos/PicturElements/" + inputArr[1] + "/contents";
  for (var i = 2; i < inputArr.length; i++) {
    url += "/" + inputArr[i];
  }
  win.setAttribute("root", inputArr[1]);
  return url;
}

function loadFiles(url, elem, file) {
  var arr = url.split("/");
  var w = getParent(elem, "window");
  var index = parseInt(w.id), win = windows[index];
  var btns = w.getElementsByClassName("histbtn");
  btns[3].setAttribute("active", arr.length > 7 || file != null);
  elem = w.getElementsByClassName("filecontent")[0];
  elem.innerHTML = "<div class='loadwrapper'><div class='loader dark'></div><div class='loader2 dark'></div><div class='loader3 dark'></div></div>";
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function () {
    if (this.readyState == 4 && this.status == 200) {
      var doc = JSON.parse(this.responseText), cutoff = 1;
      if (!Array.isArray(doc)) { doc = [doc]; cutoff = 0; }

      if (file != null) {
        var fb = getFileObj(doc, file);
        if (fb == null) {
          elem.innerHTML = "<div class='fileerror'>Couldn't find file.</div>";
          return;
        }
        url += ("/" + file);
        doc = [fb];
        cutoff = 0;
      }

      if (win.history[win.histPointer] != url || win.histPointer == -2) {
        win.histPointer += 2;
        win.history[win.histPointer] = url;
        win.history[win.histPointer + 1] = "P:\\" + w.getAttribute("root") + (doc[0].path != undefined ? morePath(doc[0].path, cutoff) : "").replace(/\//g, "\\");
        win.history.splice(win.histPointer + 2, win.history.length - (win.histPointer + 2));
        //console.log(win.history);
      }

      btns[0].setAttribute("active", (win.histPointer > 0));
      btns[1].setAttribute("active", (win.histPointer < win.history.length - 2));

      //console.log(win.histPointer);
      w.getElementsByClassName("path")[0].value = win.history[win.histPointer + 1];

      elem.innerHTML = "";
      createLink(elem, "file tableheader hideable", "return;", "Name", "File type", "Size");
      for (var i in doc) {
        if (doc[i].type == "dir") {
          createLink(elem, "file dir", "loadFilesRelay(this)", doc[i].name, "SnOS Folder", "", doc[i].url);
        }
      }
      for (var i in doc) {
        if (doc[i].type == "file") {
          var ext = getExtension(doc[i].name);
          var type = getType(ext);
          var func = "";
          var attrUrl = null;
          if (type[0] == "doc") {
            func = "relayAddWindow(" + viewerID + ",'" + doc[i].name + "',this)";
            attrUrl = "https://picturelements.github.io/PeNote2?url=" + doc[i].download_url;
            //console.log(func);
          } else {
            func = "relayAddWindow(" + viewerID + ",'" + doc[i].name + "',this)";
            attrUrl = "https://picturelements.github.io/PeViewer?type=" + type[0] + "&url=" + doc[i].download_url;
          }
          createLink(elem, "file " + type[0] + " " + ext, func, doc[i].name, type[1], getSize(doc[i].size), attrUrl);
        }
      }
    } else if (this.status == 404) {
      elem.innerHTML = "<div class='fileerror'>Couldn't find " + (arr.length == 7 ? "repository" : (arr[arr.length - 1].includes(".") ? "file" : "folder")) + ".</div>";
    } else if (this.status == 403) {
      //If the blob is too large, try looking for the folder
      var newFile = arr[arr.length - 1];
      newUrl = url.split("/" + newFile)[0];
      console.warn("Don't worry. I've got this.");
      loadFiles(newUrl, elem, newFile);
      return;
    }
  };
  xhttp.onerror = function () {
    elem.innerHTML = "<div class='fileerror'>Couldn't load files.<br>Click to try again.</div>";
    elem.getElementsByClassName("fileerror")[0].setAttribute("onclick", "loadFiles('" + url + "',this)");
  };
  xhttp.open("GET", url, true);
  xhttp.send();
}

function getFileObj(obj, file) {
  for (var elem in obj) {
    if (obj[elem].name == file) {
      return obj[elem];
    }
  }
  return null;
}

function morePath(path, cutoff) {
  var arr = path.split("/");
  var result = "";
  for (var i = 0; i < arr.length - cutoff; i++) {
    result += "/" + arr[i];
  }
  return result;
}

function getExtension(filename) {
  var arr = filename.split(".");
  if (arr.length > 1) {
    return arr[arr.length - 1];
  }
  return "";
}

function getType(extension, findType) {
  for (var obj in types) {
    for (var i = 0; i < types[obj].length; i += 2) {
      if (types[obj][i] == extension) {
        return [obj, types[obj][i + 1]];
      }
    }
  }
  return ["doc", "<span class='yell'>" + extension + "</span> file"];
}

function getSize(bytes) {
  if (bytes < 1000) { return bytes + " B"; }
  if (bytes < 1e6) { return round(bytes / 1000, 1) + " kB"; }
  if (bytes < 1e9) { return round(bytes / 1e6, 1) + " MB"; }
}

function round(num, dec) {
  var dec = Math.pow(10, dec);
  return Math.round(num * dec) / dec;
  /*var str=""+Math.round(num*dec)/dec;
  var arr=str.split(".");
  if (arr.length==1){arr.push("0")}
  str=arr[0]+"."+arr[1].substring(0,dec);
  return parseFloat(str);*/
}

function createLink(elem, cName, func, name, tpe, sze, url) {
  var item = document.createElement("div");
  item.className = cName;
  item.setAttribute("ondblclick", func);
  var wrapper = document.createElement("div");
  wrapper.className = "mainwrapper";
  var infowrapper = document.createElement("div");
  infowrapper.className = "infowrapper hideable";
  var icon = document.createElement("div");
  icon.className = "icon";
  var title = document.createElement("div");
  title.className = "title";
  title.textContent = name;
  var type = document.createElement("div");
  type.className = "filetype";
  type.innerHTML = tpe;
  var size = document.createElement("div");
  size.className = "size";
  size.innerHTML = sze;

  item.setAttribute("url", url);

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  infowrapper.appendChild(type);
  infowrapper.appendChild(size);
  item.appendChild(wrapper);
  item.appendChild(infowrapper);
  elem.appendChild(item);
}

function relayAddWindow(id, name, elem) {
  var url = elem.getAttribute("url");
  addWindow(id, name, url, DEF_WIN_W, DEF_WIN_H, getType(getExtension(url))[0])
}

// example: addWindow(viewerID, null, "https://taco.com", DEF_WIN_W, DEF_WIN_H);

function loadFilesRelay(elem) {
  loadFiles(elem.getAttribute("url"), elem);
}

function getParent(elem, cName) {
  while (true) {
    if (elem.classList.contains(cName)) { return elem; }
    elem = elem.parentElement;
    if (elem.tagName == "BODY") { return null; }
  }
}

function toggleGT() {
  var cl = document.body.classList;
  if (cl.contains("grid")) {
    cl.remove("grid");
    cl.add("table");
    SnStore.set("viewmode", "table");
  } else {
    cl.remove("table");
    cl.add("grid");
    SnStore.set("viewmode", "grid");
  }
}

function contextOpenFile() {
  var elem = getExplorerItem();
  var dbl = new MouseEvent("dblclick");
  elem.dispatchEvent(dbl);
}

function contextNewDir(openNew) {
  var elem = getExplorerItem();
  var window = getParent(elem, "window");
  var path = window.getElementsByClassName("path")[0].value;
  var name = elem.getElementsByClassName("title")[0].innerHTML;
  if (!path.endsWith(name)) { path += "\\" + name; }
  if (openNew) {
    addWindow(explorerID, null, path, DEF_WIN_W, DEF_WIN_H);
  } else {
    parseGeneralURL(window, path);
  }
}

function contextOpenHTML() {
  var elem = getExplorerItem();
  var url = elem.getAttribute("url").replace("https://raw.githubusercontent.com/DevDevil-RBLX/", "https://").replace("/master", "").split("=")[1];
  var title = elem.getElementsByClassName("title")[0].innerHTML;
  addWindow(viewerID, title, url, DEF_WIN_W, DEF_WIN_H, "html");
}

function getExplorerItem() {
  var cont = document.getElementById("context");
  return document.getElementById(cont.getAttribute("target")).getElementsByClassName("file")[cont.getAttribute("targetIndex")];
}

function moveUp(elem) {
  var window = getParent(elem, "window");
  var index = parseInt(window.id), win = windows[index];
  var pathSplit = window.getElementsByClassName("path")[0].value.split("\\");
  var newUrl = pathSplit[0];
  for (var i = 1; i < pathSplit.length - 1; i++) { newUrl += ("\\" + pathSplit[i]); }
  if (newUrl == win.history[win.histPointer - 1]) {
    moveHist(index, -1);
  } else {
    parseGeneralURL(window, newUrl);
  }
}

function consoleOpenWin(str) {
  var origStr = str;
  str = str.toLowerCase();
  if (!str.startsWith("http")) {
    for (var i in programData) {
      if (programData[i].name.toLowerCase() == str) {
        if (str == "settings") { openSettings(); return; }
        addWindow(i, null, null, DEF_WIN_W, DEF_WIN_H);
        return;
      }
    }
    openPopup("Program Launch Error", "There is no program with name '" + str + "' on this device.");
  } else {
    if (str.endsWith(".html") && str.includes("DevDevil-RBLX.github.io")) {
      addWindow(viewerID, urlToDir(origStr), apiToHttps(origStr), DEF_WIN_W, DEF_WIN_H, "html");
    } else {
      addWindow(explorerID, null, origStr, DEF_WIN_W, DEF_WIN_H);
    }
  }
}

function urlToDir(inp) {
  if (inp.startsWith("P:")) {
    return inp;
  }
  inp = inp.split("?")[0].split("/");
  var out = "P:\\" + inp[5];
  for (var i = 7; i < inp.length; i++) {
    out += "\\" + inp[i];
  }
  return out;
}

function apiToRaw(url) {
  return (url.replace("api.github.com/repos", "raw.githubusercontent.com").replace("/contents", "/master")).split("?")[0];
}

function apiToHttps(url) {
  return (url.replace("api.github.com/repos/DevDevil-RBLX/", "").replace("/contents", "")).split("?")[0];
}

//loadFiles("https://api.github.com/repos/PicturElements/picturelements.github.io/contents");

function randWifi() {
  document.getElementById("wifi").setAttribute("level", Math.floor(Math.random() * 4));
}

setInterval(randWifi, 3000);

function setIcon(obj, elem) {
  if (obj.letter != undefined) {
    // Custom apps: a coloured tile with the first letter, drawn here so the desktop
    // never contacts the site (a favicon fetch would reveal the user's address).
    var svgNs = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("class", "letter_icon");
    var rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("x", "2"); rect.setAttribute("y", "2");
    rect.setAttribute("width", "36"); rect.setAttribute("height", "36");
    rect.setAttribute("rx", "8");
    rect.setAttribute("fill", obj.color || LETTER_COLORS[0]);
    var text = document.createElementNS(svgNs, "text");
    text.setAttribute("x", "20"); text.setAttribute("y", "27.5");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "21");
    text.setAttribute("font-family", "Segoe UI, system-ui, sans-serif");
    text.setAttribute("font-weight", "600");
    text.setAttribute("fill", "#fff");
    text.textContent = obj.letter;
    svg.appendChild(rect);
    svg.appendChild(text);
    elem.textContent = "";
    elem.style.backgroundImage = "none";
    elem.appendChild(svg);
  } else if (obj.url != undefined) {
    elem.style.backgroundImage = "url(resources/media/app_icons/" + obj.url + ".png)";
  } else if (obj.svg != undefined) {
    var html = document.getElementById("svgbuffer").getElementsByClassName(obj.svg)[0].outerHTML;
    elem.innerHTML = html;
  } else {
    elem.parentElement.classList.add("file", getType(obj.file)[0], obj.file);
  }
}


// The Battery Status API does not exist in Firefox or Safari, and is
// unavailable in insecure contexts; calling it unguarded throws.
if (typeof navigator.getBattery === "function") {
  navigator.getBattery().then(function (battery) {
    updateAll();
    battery.addEventListener('chargingchange', updateAll);
    battery.addEventListener('levelchange', updateAll);

    var warned = false;
    function updateAll() {
      var batt = document.getElementById("battery");
      var lvl = Math.floor(battery.level * 100);
      var charging = battery.charging && lvl != 100;
      batt.setAttribute("charging", charging);
      document.getElementById("batterywrapper").setAttribute("data-title", lvl + "% charged" + (charging ? " (charging)" : ""));
      batt.getElementsByClassName("batteryindicator")[0].setAttribute("width", lvl);
      if (charging) {
        warned = false;
      } else if (lvl <= 10 && !warned) {
        warned = true; // one warning per discharge, not one per percent
        openPopup("Battery level low", "The battery level is low (" + lvl + "%). Consider plugging in your charger.");
      }
    }
  }).catch(function () { /* no battery information available */ });
}
