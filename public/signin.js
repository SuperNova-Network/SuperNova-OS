/*
 * The sign-in screen: shown instead of the desktop when the site needs an account
 * (ACCOUNTS=required). Signing in goes through SnAccount, so this browser picks up
 * the account's settings exactly as it does from Settings > Account.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Where to go afterwards: a path on this site (the server checks this too).
  const next = (() => {
    const value = new URLSearchParams(location.search).get("next") ?? "/";
    return /^\/(?![/\\])/.test(value) && !value.startsWith("/signin") ? value : "/";
  })();
  const proceed = () => location.replace(next);

  const forms = { login: $("form-login"), register: $("form-register"), recover: $("form-recover") };
  const tabs = [...document.querySelectorAll(".tab")];

  function show(mode) {
    for (const [key, form] of Object.entries(forms)) {
      form.hidden = key !== mode;
      form.querySelector(".error").textContent = "";
    }
    // "Forgot password" belongs to the sign-in tab.
    tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.mode === (mode === "recover" ? "login" : mode))));
    const form = forms[mode];
    const typed = Object.values(forms).map((f) => f.elements.username.value).find(Boolean) ?? "";
    form.elements.username.value ||= typed;
    form.elements[form.elements.username.value ? (mode === "recover" ? "code" : "password") : "username"].focus();
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.mode)));
  document.querySelectorAll("[data-show]").forEach((button) => button.addEventListener("click", () => show(button.dataset.show)));

  function submitting(form, action) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      const error = form.querySelector(".error");
      button.disabled = true;
      error.textContent = "";
      try {
        const result = await action(form.elements);
        if (result.recoveryCode) {
          $("recovery-code").textContent = result.recoveryCode;
          $("forms").hidden = true;
          $("setup").hidden = true;
          $("footnote").hidden = true;
          $("code").hidden = false;
          $("copy").focus();
        } else {
          proceed();
        }
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
      }
    });
  }

  submitting(forms.login, (f) => SnAccount.login(f.username.value, f.password.value));
  submitting(forms.register, (f) => {
    if (f.password.value !== f.confirm.value) return Promise.reject(new Error("The passwords don't match."));
    return SnAccount.register(f.username.value, f.password.value, f.invite.value);
  });
  submitting(forms.recover, (f) => SnAccount.recover(f.username.value, f.code.value, f.password.value));
  submitting($("form-setup"), (f) => {
    if (f.password.value !== f.confirm.value) return Promise.reject(new Error("The passwords don't match."));
    return SnAccount.setup(f.code.value, f.username.value, f.password.value);
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("recovery-code").textContent);
      $("copy").textContent = "Copied";
    } catch {
      getSelection().selectAllChildren($("recovery-code"));
    }
  });
  $("continue").addEventListener("click", proceed);

  SnAccount.status().then((state) => {
    $("loading").hidden = true;
    if (state.user) { proceed(); return; }
    if (location.pathname === "/setup" && state.setup) {
      $("footnote").hidden = true;
      $("setup").hidden = false;
      $("form-setup").elements.code.focus();
      return;
    }
    // Accounts off: only admins sign in (to reach Settings > Admin).
    if (!state.enabled) $("off").hidden = false;
    $("tab-register").hidden = !state.signup;
    $("invite-field").hidden = !state.invite;
    forms.register.elements.invite.required = Boolean(state.invite);
    $("forms").hidden = false;
    show("login");
  }, () => {
    $("loading").textContent = "Couldn't reach the server. Reload to try again.";
  });
})();
