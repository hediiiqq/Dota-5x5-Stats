const integerFormatter = new Intl.NumberFormat("ru-RU");
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

const surfaceMotions = new Map();
let motionCleanupInstalled = false;

// A small response to changing a view; the interface never depends on GSAP loading.
export function animateSurface(root) {
  const gsap = globalThis.gsap;
  if (!root || root.isConnected === false || !gsap?.matchMedia) return;
  surfaceMotions.get(root)?.revert();
  const media = gsap.matchMedia();
  surfaceMotions.set(root, media);
  const release = () => {
    media.revert();
    if (surfaceMotions.get(root) === media) surfaceMotions.delete(root);
  };
  media.add("(prefers-reduced-motion: no-preference)", () => {
    gsap.fromTo(root, { y: 4, opacity: .92 }, {
      y: 0, opacity: 1, duration: .24, ease: "expo.out", overwrite: "auto",
      onComplete: release,
    });
  });
  // A non-matching query creates no tween and needs no retained listener.
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) release();
  if (!motionCleanupInstalled) {
    globalThis.addEventListener("pagehide", () => {
      for (const context of surfaceMotions.values()) context.revert();
      surfaceMotions.clear();
    });
    motionCleanupInstalled = true;
  }
}

export function element(tag, className = "", text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? integerFormatter.format(value) : "—";
}

export function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormatter.format(parsed);
}

export function duration(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function winner(value) {
  const name = value === "radiant" ? "Radiant" : value === "dire" ? "Dire" : "Не определён";
  const side = value === "radiant" || value === "dire" ? value : "unknown";
  return element("span", `badge ${side}`, name);
}

export function offsetFromURL() {
  const raw = new URLSearchParams(location.search).get("offset") ?? "0";
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value <= Number.MAX_SAFE_INTEGER - 100 ? value : 0;
}

const historyPageSizes = [5, 10, 15, 20, 50, 100];
const historyPageSizeKey = "dota-stats.history-page-size";

export function historyPageSize(raw) {
  return historyPageSizes.find(size => String(size) === raw) ?? 5;
}

export function historyPageSizeFromURL() {
  const raw = new URLSearchParams(location.search).get("limit");
  if (raw !== null) return historyPageSize(raw);
  try { return historyPageSize(localStorage.getItem(historyPageSizeKey)); }
  catch { return 5; }
}

export function saveHistoryPageSize(size) {
  try { localStorage.setItem(historyPageSizeKey, String(size)); }
  catch { /* Pagination remains usable when browser storage is unavailable. */ }
}

export function historyPageURL(offset, limit) {
  return `/?limit=${limit}${offset ? `&offset=${offset}` : ""}`;
}

export function matchID(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
  return BigInt(value) <= 9223372036854775807n ? value : null;
}

export function steamProfileURL(accountID) {
  if (typeof accountID !== "string" || !/^[1-9]\d{0,9}$/.test(accountID)) return null;
  const id = BigInt(accountID);
  if (id > 4294967295n) return null;
  return `https://steamcommunity.com/profiles/${76561197960265728n + id}/`;
}

export function imageURL(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function image(value, className, alt, size, fallbackURLs = []) {
  const url = imageURL(value);
  if (!url) return null;
  const img = element("img", className);
  img.alt = alt;
  img.width = size;
  img.height = size;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  const alternatives = [...new Set(fallbackURLs.map(imageURL).filter(candidate => candidate && candidate !== url))];
  img.addEventListener("error", () => {
    const next = alternatives.shift();
    if (next) img.src = next;
    else img.hidden = true;
  });
  img.src = url;
  return img;
}

export function heroBadge(hero) {
  const badge = element("span", "hero-identity");
  const icon = image(hero.hero_icon_url, "hero-icon", "", 32);
  if (icon) badge.append(icon);
  badge.append(element("span", "", hero.hero_name || (hero.hero_id == null ? "—" : `Герой #${hero.hero_id}`)));
  return badge;
}

export async function requestJSON(path, signal) {
  let response;
  try {
    response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Не удалось связаться с сервером. Проверьте подключение и повторите попытку.");
  }
  let data;
  try {
    const source = await response.text();
    // Consume complete JSON strings, including nicknames, before quoting integer id fields.
    // PostgreSQL BIGINT IDs must survive JSON parsing without rounding in JavaScript.
    const preserved = source.replace(/"(?:\\.|[^"\\])*"(?:\s*:\s*(-?\d+))?/g, (token, digits) => {
      return digits !== undefined && /^"id"\s*:/.test(token) ? `"id":"${digits}"` : token;
    });
    data = JSON.parse(preserved);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const failure = new Error("Сервер вернул некорректный ответ. Попробуйте ещё раз.");
    failure.status = response.status;
    throw failure;
  }
  if (!response.ok) {
    const failure = new Error(response.status >= 500
      ? "Не удалось загрузить данные. Попробуйте ещё раз."
      : data?.error?.message || "Не удалось выполнить запрос.");
    failure.status = response.status;
    throw failure;
  }
  return data;
}

export function showStatus(container, title, message = "", retry) {
  container.replaceChildren();
  container.hidden = false;
  container.append(element("h2", "status-title", title));
  if (message) container.append(element("p", "muted", message));
  if (retry) {
    const button = element("button", "button", "Повторить");
    button.type = "button";
    button.addEventListener("click", retry);
    container.append(button);
  }
}

export function showLoading(container, message) {
  container.replaceChildren(element("span", "spinner"), element("p", "", message));
  container.firstChild.setAttribute("aria-hidden", "true");
  container.hidden = false;
}
