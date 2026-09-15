/* =============================================================
   ui.js — shared UI helpers (toasts, confirm dialog, field errors)

   Loaded on every page before the page script. No dependencies.
   Replaces window.alert / window.confirm with in-app equivalents.
   ============================================================= */

"use strict";

/* ── Toasts ─────────────────────────────────────────────── */
const TOAST_ICONS = { info: "ℹ", success: "✓", warning: "!", error: "✕" };

function getToastRoot() {
  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.className = "toast-root";
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-relevant", "additions");
    document.body.appendChild(root);
  }
  return root;
}

/**
 * showToast("Saved", { type: "success" })
 * type: info | success | warning | error   duration: ms (0 = sticky)
 * action: { label, onClick } renders an inline button.
 */
function showToast(message, { type = "info", duration = 4000, action = null } = {}) {
  const root  = getToastRoot();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] ?? TOAST_ICONS.info}</span>
    <span class="toast-msg"></span>
    ${action ? `<button type="button" class="toast-action"></button>` : ""}
    <button type="button" class="toast-close" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector(".toast-msg").textContent = message;
  if (action) {
    const btn = toast.querySelector(".toast-action");
    btn.textContent = action.label;
    btn.addEventListener("click", () => { action.onClick?.(); dismiss(); });
  }
  const dismiss = () => {
    if (!toast.isConnected) return;
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  };
  toast.querySelector(".toast-close").addEventListener("click", dismiss);
  root.appendChild(toast);
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

/* ── Confirm dialog ─────────────────────────────────────── */
/**
 * const ok = await confirmDialog({ title, body, confirmLabel, cancelLabel, danger })
 * Resolves true/false. Escape / backdrop click = cancel. Focus is trapped
 * and restored afterwards. Reuses the .modal-* styles from styles.css.
 */
function confirmDialog({ title = "Are you sure?", body = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    const returnEl = document.activeElement;
    const overlay  = document.createElement("div");
    overlay.className = "modal-overlay confirm-overlay";
    overlay.innerHTML = `
      <div class="modal-box confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmBody" tabindex="-1">
        <div class="modal-header">
          <h3 class="modal-title" id="confirmTitle"></h3>
        </div>
        <div class="modal-body" id="confirmBody"></div>
        <div class="confirm-actions">
          <button type="button" class="ghost-btn" data-act="cancel"></button>
          <button type="button" class="primary-btn${danger ? " danger" : ""}" data-act="ok"></button>
        </div>
      </div>`;
    overlay.querySelector("#confirmTitle").textContent = title;
    overlay.querySelector("#confirmBody").textContent  = body;
    overlay.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    overlay.querySelector('[data-act="ok"]').textContent     = confirmLabel;

    const finish = result => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      overlay.classList.remove("modal-visible");
      setTimeout(() => overlay.remove(), 250);
      if (returnEl && typeof returnEl.focus === "function") returnEl.focus();
      resolve(result);
    };
    const onKey = e => {
      if (e.key === "Escape") { finish(false); return; }
      if (e.key !== "Tab") return;
      const f = overlay.querySelectorAll("button");
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    overlay.addEventListener("click", e => { if (e.target === overlay) finish(false); });
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(false));
    overlay.querySelector('[data-act="ok"]').addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      overlay.classList.add("modal-visible");
      overlay.querySelector('[data-act="cancel"]').focus();
    });
  });
}

/* ── Field-level errors ─────────────────────────────────── */
/**
 * setFieldError(inputEl, "message")  → paints an error under the input
 * setFieldError(inputEl, null)       → clears it
 * The message element is created next to the input (after it) if missing.
 */
function setFieldError(input, message, { kind = "error" } = {}) {
  if (!input) return;
  let msg = input.nextElementSibling;
  if (!msg || !msg.classList.contains("field-msg")) {
    msg = document.createElement("small");
    msg.className = "field-msg";
    msg.setAttribute("aria-live", "polite");
    input.insertAdjacentElement("afterend", msg);
  }
  msg.classList.remove("is-error", "is-warn");
  if (message) {
    msg.textContent = message;
    msg.classList.add(kind === "warn" ? "is-warn" : "is-error");
    input.setAttribute("aria-invalid", kind === "error" ? "true" : "false");
    if (kind === "error") input.focus({ preventScroll: false });
  } else {
    msg.textContent = "";
    input.setAttribute("aria-invalid", "false");
  }
}

/* Clear a field's error as soon as the user edits it. */
document.addEventListener("input", e => {
  const el = e.target;
  if (el.matches?.("input, select") && el.getAttribute("aria-invalid") === "true") {
    const msg = el.nextElementSibling;
    if (msg?.classList.contains("field-msg") && msg.classList.contains("is-error")) {
      msg.textContent = ""; msg.classList.remove("is-error");
    }
    el.setAttribute("aria-invalid", "false");
  }
}, true);
