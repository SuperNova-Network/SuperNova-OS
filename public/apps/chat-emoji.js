/*
 * The emoji picker's data: categories of emoji, each a space-separated list.
 * Single characters (and a few with a variation selector) only, so every one shows
 * up the same in a plain text field. Plain script; attaches `CHAT_EMOJI` to window.
 */
window.CHAT_EMOJI = [
  { id: "smileys", label: "Smileys", icon: "😀", list: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🫠 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃" },
  { id: "gestures", label: "People", icon: "👍", list: "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 💁 🙇 🕺 💃 🏃 🚶 🧍" },
  { id: "hearts", label: "Hearts", icon: "❤️", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 🗯️ 💭 💤 ✨ 🌟 ⭐ 🔥 🌈 ☀️ 🌙 ⚡ ❄️ ☁️ 🌊" },
  { id: "animals", label: "Animals", icon: "🐶", list: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🪲 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🐪 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🦚 🦜 🦢 🕊️ 🐇 🦝 🦨 🦡 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🌺 🌻 🌹 🌷 🌼 🌸" },
  { id: "food", label: "Food", icon: "🍕", list: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🍞 🥖 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾" },
  { id: "activities", label: "Games", icon: "🎮", list: "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🎱 🏓 🏸 🏒 🥍 🏏 ⛳ 🏹 🎣 🥊 🥋 🎽 🛹 🛼 ⛸️ 🥌 🎿 ⛷️ 🏂 🏋️ 🤸 🏆 🥇 🥈 🥉 🏅 🎖️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩 🎰 🎁 🎈 🎉 🎊 🪅" },
  { id: "travel", label: "Travel", icon: "🚀", list: "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🚚 🚛 🚜 🛵 🏍️ 🚲 🛴 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🚁 🚀 🛸 🛰️ ⛵ 🚤 🛥️ 🚢 ⚓ 🚧 ⛽ 🚦 🗺️ 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏔️ ⛰️ 🌋 🏕️ 🏠 🏡 🏢 🏫 🏥 🌃 🌆 🌇 🌉 🌌 🌍 🌎 🌏 🪐 🌠 ☄️" },
  { id: "objects", label: "Objects", icon: "💡", list: "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⏳ 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 🔧 🔨 ⚒️ 🛠️ ⚙️ 🔩 🧲 💣 🧨 🔪 🛡️ 🔮 📿 💈 🔭 🔬 💊 💉 🧬 🦠 🧪 🌡️ 🧹 🧺 🧻 🚿 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🖼️ 🛍️ 📦 📫 ✉️ 📝 📁 📅 📌 📎 ✂️ 🔒 🔓 🔔 🔕 📣 📢" },
  { id: "symbols", label: "Symbols", icon: "✅", list: "✅ ❌ ❎ ➕ ➖ ✖️ ➗ ❓ ❔ ❕ ❗ ‼️ ⁉️ 💲 ♻️ ⚠️ 🚫 ⛔ 🔞 📵 🔰 ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ 🔀 🔁 🔂 🔼 🔽 ⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 🔙 🔚 🔛 🔝 ✔️ ☑️ 🔘 🆗 🆒 🆕 🆓 🆙 🆘 ℹ️ Ⓜ️ 🅰️ 🅱️ 🅾️ 🅿️ #️⃣ 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 © ® ™" },
];
