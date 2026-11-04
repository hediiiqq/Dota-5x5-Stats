import {element, matchID} from "./common.js";

const levels = {info:"Информация", warning:"Предупреждение", error:"Ошибка"};
const stages = {steam_connect:"Подключение к Steam", awaiting_guard:"Подтверждение Steam Guard", gc_connect:"Подключение к Dota 2", history:"История матчей", details:"Подробности матчей", saving:"Сохранение матчей", metadata:"Метаданные"};
const eventTime = new Intl.DateTimeFormat("ru-RU", {day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit"});

export function validateEventsPage(payload, before = null) {
  if (!payload || !Array.isArray(payload.events) || payload.events.length > 20 ||
      (payload.next_before !== null && !matchID(payload.next_before))) throw new Error("invalid_events");
  let previous = before;
  for (const event of payload.events) {
    if (!event || !matchID(event.id) || !matchID(event.job_id) ||
        !Object.hasOwn(levels, event.level) || typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at)) ||
        typeof event.message !== "string" || !event.message.trim() ||
        (event.stage !== null && typeof event.stage !== "string") ||
        (event.dota_match_id !== null && !matchID(event.dota_match_id)) ||
        (previous !== null && BigInt(event.id) >= BigInt(previous))) throw new Error("invalid_event");
    previous = event.id;
  }
  if (payload.next_before !== null && payload.next_before !== previous) throw new Error("invalid_cursor");
  if (!payload.events.length && payload.next_before !== null) throw new Error("empty_cursor");
  return {events:payload.events, nextBefore:payload.next_before};
}

export function createEventJournal(root) {
  const access = element("section", "panel journal-access");
  const accessTitle = element("h2", "", "Проверяем доступ…");
  const accessDescription = element("p", "", "Журнал доступен только администраторам сайта.");
  const login = element("a", "button", "Перейти ко входу");
  login.href = "/?view=admin";
  const retry = element("button", "button button-quiet", "Проверить доступ снова");
  retry.type = "button";
  const accessActions = element("div", "admin-actions");
  accessActions.append(login, retry);
  access.append(accessTitle, accessDescription, accessActions);
  const content = element("section", "journal-content");
  content.hidden = true;
  const tools = element("div", "journal-tools");
  const controls = element("div", "journal-controls");
  const refreshButton = element("button", "button button-quiet", "Обновить журнал");
  refreshButton.type = "button";
  const auto = element("input");
  auto.type = "checkbox"; auto.checked = true;
  const autoLabel = element("label", "journal-auto");
  autoLabel.append(auto, element("span", "", "Обновлять каждые 5 секунд"));
  controls.append(refreshButton, autoLabel);
  const count = element("span", "journal-count");
  tools.append(controls, count);
  const feedback = element("p", "journal-feedback");
  feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
  const table = element("table", "journal-table");
  const caption = element("caption", "journal-caption", "События импорта: новые сверху. Время по вашему устройству.");
  const head = element("thead");
  const headRow = element("tr");
  for (const title of ["Время", "Уровень", "Задание", "Dota Match ID", "Событие"]) {
    const th = element("th", "", title); th.scope = "col"; headRow.append(th);
  }
  head.append(headRow);
  const body = element("tbody");
  table.append(caption, head, body);
  const empty = element("p", "journal-empty", "Событий пока нет. Они появятся после запуска задания импорта.");
  empty.hidden = true;
  const footer = element("div", "journal-footer");
  const moreButton = element("button", "button button-quiet", "Показать более старые");
  moreButton.type = "button"; moreButton.hidden = true;
  footer.append(moreButton);
  content.append(tools, feedback, table, empty, footer);
  root.replaceChildren(access, content);

  let authorized = false, busy = false, stopped = false, olderLoaded = false;
  let events = [], nextBefore = null, timer = null, current = null, generation = 0;
  function pause() { clearTimeout(timer); timer = null; }
  function schedule() {
    pause();
    if (authorized && !stopped && !busy && auto.checked && !olderLoaded && document.visibilityState !== "hidden") {
      timer = setTimeout(() => refresh(), 5000);
    }
  }
  function updateControls() {
    refreshButton.disabled = busy; moreButton.disabled = busy;
    moreButton.hidden = !nextBefore;
    content.setAttribute("aria-busy", String(busy));
  }
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.className = error ? "journal-feedback journal-feedback-error" : "journal-feedback";
  }
  function deny(status) {
    authorized = false; pause(); events = []; nextBefore = null;
    body.replaceChildren(); content.hidden = true; access.hidden = false;
    accessTitle.textContent = status === 403 ? "Нет прав администратора" : "Сессия завершена. Вход в журнал";
    accessDescription.textContent = status === 403 ? "Вашему Steam-аккаунту не разрешён просмотр журнала." : "Войдите в админку через Steam и вернитесь в журнал событий.";
  }
  function render() {
    body.replaceChildren(...events.map(event => {
      const row = element("tr");
      const timeCell = element("td");
      const time = element("time", "", eventTime.format(new Date(event.created_at)));
      time.dateTime = event.created_at; timeCell.append(time);
      const level = element("td");
      level.append(element("span", `journal-level journal-level-${event.level}`, levels[event.level]));
      const job = element("td", "journal-id", `#${event.job_id}`);
      const match = element("td", "journal-id", event.dota_match_id ?? "—");
      const details = element("td");
      details.append(element("p", "journal-message", event.message));
      if (event.stage) details.append(element("span", "journal-stage", stages[event.stage] || event.stage));
      row.append(timeCell, level, job, match, details);
      return row;
    }));
    count.textContent = `Показано событий: ${events.length}`;
    empty.hidden = events.length > 0; table.hidden = !events.length;
    updateControls();
  }
  async function request(url) {
    const controller = new AbortController(); current = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {credentials:"same-origin", cache:"no-store", redirect:"error", signal:controller.signal});
      return {status:response.status, ok:response.ok, data:response.ok ? await response.json() : null};
    } finally {
      clearTimeout(timeout);
      if (current === controller) current = null;
    }
  }
  async function load(append = false) {
    if (!authorized || busy || stopped || (append && !nextBefore)) return;
    pause(); busy = true; updateControls();
    const ticket = generation, before = append ? nextBefore : null;
    message(append ? "Загружаем более старые события…" : "Обновляем журнал…");
    try {
      const response = await request(`/api/admin/import-events?limit=20${before ? `&before=${before}` : ""}`);
      if (ticket !== generation || stopped) return;
      if (response.status === 401 || response.status === 403) { deny(response.status); return; }
      if (!response.ok) throw new Error("events_unavailable");
      const page = validateEventsPage(response.data, before);
      events = append ? [...events, ...page.events] : page.events;
      nextBefore = page.nextBefore; olderLoaded = append;
      render();
      message(append ? "Просмотр истории. Нажмите «Обновить журнал», чтобы вернуться к последним событиям." : `Обновлено в ${new Date().toLocaleTimeString("ru-RU")}. Время событий — по вашему устройству.`);
    } catch {
      if (ticket !== generation || stopped) return;
      message(append ? "Не удалось загрузить старые события. Повторите запрос кнопкой ниже." : "Не удалось обновить журнал. Нажмите «Обновить журнал», чтобы повторить." , true);
    } finally {
      if (ticket === generation) { busy = false; updateControls(); schedule(); }
    }
  }
  async function start() {
    if (busy) return;
    stopped = false; pause(); busy = true; authorized = false;
    const ticket = ++generation;
    body.replaceChildren(); events = []; nextBefore = null; olderLoaded = false;
    content.hidden = true; access.hidden = false; accessTitle.textContent = "Проверяем доступ…";
    retry.disabled = true;
    try {
      const response = await request("/api/admin/session");
      if (ticket !== generation || stopped) return;
      if (response.status === 401 || response.status === 403) { deny(response.status); return; }
      if (!response.ok || !matchID(response.data?.admin?.steam_id) || typeof response.data?.expires_at !== "string" || !Number.isFinite(Date.parse(response.data.expires_at)) || Date.parse(response.data.expires_at) <= Date.now()) throw new Error("invalid_session");
      authorized = true; access.hidden = true; content.hidden = false;
    } catch {
      if (ticket !== generation || stopped) return;
      accessTitle.textContent = "Не удалось проверить доступ";
      accessDescription.textContent = "Проверьте соединение и повторите проверку доступа.";
    } finally {
      if (ticket === generation) { busy = false; retry.disabled = false; }
    }
    if (authorized && ticket === generation) await load();
  }
  function stop() {
    stopped = true; authorized = false; generation++; pause(); current?.abort(); busy = false;
    events = []; nextBefore = null; body.replaceChildren(); content.hidden = true;
  }
  const refresh = () => load(false);
  const more = () => load(true);
  refreshButton.addEventListener("click", refresh);
  moreButton.addEventListener("click", more);
  retry.addEventListener("click", start);
  auto.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { pause(); return; }
    if (authorized && !olderLoaded && !busy) refresh();
  });
  globalThis.addEventListener("pagehide", stop);
  globalThis.addEventListener("pageshow", event => { if (event.persisted) start(); });
  return {start, refresh, more, stop};
}

const journalRoot = document.querySelector("#event-journal");
if (journalRoot) createEventJournal(journalRoot).start();
