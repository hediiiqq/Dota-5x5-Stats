import { element, matchID } from "./common.js";

const key = "dota-stats.favorites.v1";
export function readFavorites(storage = globalThis.localStorage) {
  const value = storage.getItem(key);
  if (value === null) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Некорректные данные избранного");
  const result = {};
  for (const [id, entry] of Object.entries(parsed)) {
    if (!matchID(id) || !entry || typeof entry.note !== "string" || entry.note.length > 4000) throw new Error("Некорректная запись избранного");
    result[id] = { note: entry.note };
  }
  return result;
}
export function saveFavorite(id, entry, storage = globalThis.localStorage) {
  if (!matchID(id)) throw new Error("Некорректный ID матча");
  const saved = readFavorites(storage);
  if (entry.saved) saved[id] = { note: String(entry.note || "").slice(0, 4000) };
  else delete saved[id];
  storage.setItem(key, JSON.stringify(saved));
}
export function favoriteEditor(id, onChange) {
  const root = element("details", "favorite-editor");
  root.append(element("summary", "", "Избранное и заметка"));
  if (!matchID(id)) { root.append(element("p", "muted", "Нет ID матча")); return root; }
  const status = element("p", "muted small"); status.setAttribute("role", "status");
  const note = element("textarea", "favorite-note"); note.maxLength = 4000; note.rows = 3;
  const label = element("label", "stats-control-label", "Заметка к матчу (только в этом браузере)"); label.append(note);
  const save = element("button", "button", "Сохранить в избранное"); save.type = "button";
  const remove = element("button", "button button-quiet", "Убрать из избранного"); remove.type = "button";
  try { const current = readFavorites()[id]; note.value = current?.note || ""; remove.disabled = !current; }
  catch { status.textContent = "Не удалось прочитать избранное. Проверьте доступ к хранилищу браузера; существующие записи не изменены."; }
  function persist(saved) {
    try {
      saveFavorite(id, { saved, note: note.value }); remove.disabled = !saved;
      status.textContent = saved ? "Матч и заметка сохранены в этом браузере." : "Матч убран из избранного.";
      if (typeof onChange === "function") onChange();
    } catch { status.textContent = "Не удалось сохранить. Проверьте доступ к хранилищу браузера и свободное место. Заметка осталась в поле ввода."; }
  }
  save.addEventListener("click", () => persist(true)); remove.addEventListener("click", () => persist(false));
  root.append(label, save, remove, status); return root;
}
