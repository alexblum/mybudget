export const money = (value) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    (Number(value) || 0) / 100,
  );
export const decimal = (value) =>
  ((Number(value) || 0) / 100).toFixed(2).replace(".", ",");
export const date = (value) =>
  value
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
    : "–";
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const monthName = (value) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(`${value}-15T12:00:00`),
  );
export function cents(value) {
  const normalized = String(value)
    .trim()
    .replace(/\s|€/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Bitte einen positiven Betrag mit höchstens zwei Nachkommastellen eingeben (z. B. 125,50).",
    );
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result))
    throw new Error("Dieser Betrag ist zu groß.");
  return result;
}
export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on"))
      element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (
      ["checked", "disabled", "selected", "required", "multiple"].includes(key)
    )
      element[key] = Boolean(value);
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false)
      element.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  }
  return element;
}
const paths = {
  home: ["M3 10 12 3l9 7", "M5 9v12h14V9", "M9 21v-8h6v8"],
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
  list: ["M8 6h13M8 12h13M8 18h13", "M3 6h.01M3 12h.01M3 18h.01"],
  upload: ["M12 16V3m-5 5 5-5 5 5", "M4 15v6h16v-6"],
  more: ["M4 12h.01M12 12h.01M20 12h.01"],
  left: ["m15 5-7 7 7 7"],
  right: ["m9 5 7 7-7 7"],
  plus: ["M12 5v14M5 12h14"],
  close: ["m6 6 12 12M18 6 6 18"],
  shield: ["M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z", "m8 12 3 3 5-6"],
  wallet: ["M3 6h17v15H3z", "M3 6V3h15v3", "M15 11h6v5h-6z"],
  tag: ["M20 13 11 22 2 13V3h10l8 8z", "M7 8h.01"],
  repeat: [
    "m17 2 4 4-4 4",
    "M3 11V8a2 2 0 0 1 2-2h16",
    "m7 22-4-4 4-4",
    "M21 13v3a2 2 0 0 1-2 2H3",
  ],
  edit: ["m15 4 5 5", "M3 21l5-1L21 7a3.5 3.5 0 0 0-5-5L3 15z"],
  trash: ["M3 6h18M9 6V3h6v3", "m5 6 1 15h12l1-15M10 10v7M14 10v7"],
  search: ["M21 21l-5-5", "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  bank: ["m2 8 10-6 10 6zM4 11v8M9 11v8M15 11v8M20 11v8M2 22h20"],
  check: ["m5 12 4 4L19 6"],
  logout: ["M9 4H3v16h6M9 12h12m-5-5 5 5-5 5"],
  info: ["M12 11v6M12 7h.01", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0"],
  calendar: [
    "M3 5h18v17H3zM3 10h18M7 2v6M17 2v6",
    "M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01",
  ],
  leaf: ["M20 3C7 2 2 9 5 16s15 5 15-13Z", "M4 21 16 8"],
  cart: ["M2 3h3l3 12h10l3-9H6", "M9 20h.01M18 20h.01"],
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths[name] || paths.tag) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
export function notify(message, error = false) {
  const toast = h(
    "div",
    {
      class: `toast${error ? " error" : ""}`,
      role: error ? "alert" : "status",
    },
    message,
  );
  document.querySelector("#notifications").append(toast);
  setTimeout(() => toast.remove(), error ? 9000 : 4500);
}
export function action(label, callback, options = {}) {
  return h(
    "button",
    {
      type: "button",
      ...options,
      onclick: async (event) => {
        const button = event.currentTarget;
        if (button.disabled) return;
        button.disabled = true;
        try {
          await callback(event);
        } catch (error) {
          notify(error.message, true);
        } finally {
          button.disabled = false;
        }
      },
    },
    options.icon ? icon(options.icon) : null,
    options.iconOnly ? null : label,
  );
}
export function field(label, control, help) {
  const id = control.id || `field-${++field.number}`;
  control.id = id;
  if (help) control.setAttribute("aria-describedby", `${id}-hint`);
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    control,
    help ? h("small", { id: `${id}-hint` }, help) : null,
  );
}
field.number = 0;
export function input(value = "", attrs = {}) {
  return h("input", { value, ...attrs });
}
export function select(options, value, attrs = {}) {
  const element = h(
    "select",
    attrs,
    options.map((option) =>
      h(
        "option",
        {
          value: option.value,
          selected: String(option.value) === String(value),
        },
        option.label,
      ),
    ),
  );
  return element;
}
export function checkbox(label, checked = false) {
  const control = h("input", { type: "checkbox", checked });
  return {
    control,
    node: h("label", { class: "check-field" }, control, h("span", {}, label)),
  };
}
export function form(onSubmit, ...children) {
  const error = h("div", { role: "alert" });
  return h(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        const node = event.currentTarget;
        const submit = node.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        error.replaceChildren();
        try {
          await onSubmit(new FormData(node));
        } catch (problem) {
          error.replaceChildren(
            h("p", { class: "form-error" }, problem.message),
          );
        } finally {
          if (submit) submit.disabled = false;
        }
      },
    },
    ...children,
    error,
  );
}
export function modal(title) {
  const previouslyFocused = document.activeElement;
  const body = h("div");
  const dialog = h(
    "dialog",
    { class: "dialog", "aria-label": title },
    h(
      "div",
      { class: "dialog-header" },
      h("h2", {}, title),
      action("Schließen", () => dialog.close(), {
        class: "icon-button subtle",
        icon: "close",
        iconOnly: true,
        "aria-label": "Schließen",
      }),
    ),
    body,
  );
  dialog.addEventListener("click", (event) => {
    if (
      event.target === dialog &&
      (event.clientX < dialog.getBoundingClientRect().left ||
        event.clientX > dialog.getBoundingClientRect().right ||
        event.clientY < dialog.getBoundingClientRect().top ||
        event.clientY > dialog.getBoundingClientRect().bottom)
    )
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { body, close: () => dialog.close(), element: dialog };
}
export async function confirmAction(title, message, label = "Bestätigen") {
  return new Promise((resolve) => {
    const dialog = modal(title);
    let resolved = false;
    dialog.body.append(
      h("p", { class: "muted small" }, message),
      h(
        "div",
        { class: "form-actions" },
        action("Abbrechen", () => dialog.close(), { class: "outline" }),
        action(
          label,
          () => {
            resolved = true;
            resolve(true);
            dialog.close();
          },
          { class: "primary" },
        ),
      ),
    );
    dialog.element.addEventListener("close", () => {
      if (!resolved) resolve(false);
    });
  });
}
export function heading(title, subtitle, eyebrow = "Mein Budget") {
  return h(
    "div",
    { class: "page-title" },
    h(
      "div",
      {},
      h("p", { class: "eyebrow" }, eyebrow),
      h("h1", {}, title),
      subtitle ? h("p", { class: "subtitle" }, subtitle) : null,
    ),
  );
}
export function empty(title, description, button) {
  return h(
    "div",
    { class: "empty-state" },
    h("div", { class: "empty-icon" }, icon("leaf")),
    h("h3", {}, title),
    h("p", {}, description),
    button,
  );
}
export function categoryOptions(state, predicate = () => true) {
  return state.categories
    .filter(predicate)
    .map((category) => ({ value: category.id, label: category.name }));
}
export const budgetable = (category) =>
  !category.is_income && !category.is_excluded;
export function accountName(state, id) {
  return (
    state.accounts.find((account) => account.id === Number(id))?.name || "Konto"
  );
}
export function categoryName(state, id) {
  return (
    state.categories.find((category) => category.id === Number(id))?.name ||
    "Nicht kategorisiert"
  );
}
export function transactionPreview(transaction, state) {
  return h(
    "div",
    { class: "preview-row" },
    h(
      "div",
      { class: "row" },
      h("strong", {}, transaction.counterparty || "Ohne Gegenpartei"),
      h("strong", {}, money(transaction.amount_cents)),
    ),
    h(
      "div",
      { class: "muted" },
      `${date(transaction.booking_date)} · ${accountName(state, transaction.account_id)}`,
    ),
    transaction.purpose ? h("div", {}, transaction.purpose) : null,
  );
}
export function moneyControl(value = 0, label) {
  return input(decimal(value), {
    inputmode: "decimal",
    "aria-label": label,
    autocomplete: "off",
    required: true,
    pattern: "[0-9.]+(,[0-9]{1,2})?",
  });
}
