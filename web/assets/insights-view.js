import { element, number, duration, date, heroBadge, matchID } from "./common.js";
import { metricLabels, playerRecordLabels, summarizePlayers, rivalries, records, dailySummary, localDay, matchesInRange } from "./insights.js";
import { readFavorites, favoriteEditor } from "./favorites.js";

const decimal = value => value == null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const sections = { compare: "Сравнение", rivals: "Противостояния", records: "Рекорды", evening: "Итоги дня", favorites: "Избранное" };

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return localDay(parsed) === value ? parsed : null;
}

function calendarDay(matches, requested) {
  return calendarDate(requested) ? requested : matches.map(match => localDay(match.started_at)).filter(Boolean).sort().at(-1) || localDay(new Date());
}

export function renderMatchCalendar(matches, selectedDay, options = {}) {
  selectedDay = options.allowEmpty && !calendarDate(selectedDay) ? "" : calendarDay(matches, selectedDay);
  const selected = calendarDate(calendarDay(matches, selectedDay));
  const counts = new Map();
  for (const match of matches) { const day = localDay(match.started_at); if (day) counts.set(day, (counts.get(day) || 0) + 1); }
  let month = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  const root = element("section", "panel match-calendar"); root.setAttribute("aria-label", options.label || "Календарь матчей");
  const heading = element("div", "calendar-heading");
  const previous = element("button", "calendar-month-button", "←"); previous.type = "button"; previous.setAttribute("aria-label", "Предыдущий месяц");
  const next = element("button", "calendar-month-button", "→"); next.type = "button"; next.setAttribute("aria-label", "Следующий месяц");
  const title = element("h2", "calendar-month-title"); title.setAttribute("aria-live", "polite");
  heading.append(previous, title, next);
  const host = element("div", "calendar-grid");
  root.append(heading, host, element("p", "calendar-legend", "Зелёным отмечены дни с матчами · время местное"));
  const formatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
  function draw() {
    title.textContent = formatter.format(month);
    previous.disabled = month.getFullYear() <= 100 && month.getMonth() === 0;
    next.disabled = month.getFullYear() >= 9999 && month.getMonth() === 11;
    const table = element("table", "calendar-table");
    table.append(element("caption", "sr-only", `Матчи: ${title.textContent}`));
    const head = element("thead"), weekdays = element("tr");
    for (const name of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) { const th = element("th", "", name); th.scope = "col"; weekdays.append(th); }
    head.append(weekdays); table.append(head);
    const body = element("tbody"), offset = (month.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12).getDate();
    const cells = Math.ceil((offset + days) / 7) * 7;
    for (let start = 0; start < cells; start += 7) {
      const row = element("tr");
      for (let column = 0; column < 7; column++) {
        const day = start + column - offset + 1, cell = element("td");
        if (day >= 1 && day <= days) {
          const key = localDay(new Date(month.getFullYear(), month.getMonth(), day, 12)), count = counts.get(key) || 0;
          const link = element(options.onSelect ? "button" : "a", `calendar-day${count ? " calendar-has-matches" : ""}`, day);
          if (options.onSelect) {
            link.type = "button";
            link.addEventListener("click", () => { selectedDay = key; draw(); options.onSelect(key); });
          } else link.href = `/?view=insights&section=evening&day=${key}`;
          link.setAttribute("aria-label", `${key} · матчей: ${count}`); link.title = `${key} · матчей: ${count}`;
          if (key === selectedDay) link.setAttribute("aria-current", "date");
          if (count) { const badge = element("span", "calendar-match-count", count); badge.setAttribute("aria-hidden", "true"); link.append(badge); }
          cell.append(link);
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body); host.replaceChildren(table);
  }
  previous.addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12); draw(); });
  next.addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12); draw(); });
  draw(); return root;
}

function rangeCalendar(matches, input, label) {
  const picker = element("details", "range-date-picker");
  const summary = element("summary", "range-date-summary");
  const body = element("div", "range-date-popup");
  const calendar = element("div");
  const clear = element("button", "button button-quiet", "Сбросить дату"); clear.type = "button";
  function draw() {
    summary.textContent = `${label} · ${input.value || "Весь период"}`;
    calendar.replaceChildren(renderMatchCalendar(matches, input.value, { allowEmpty: true, label, onSelect(day) {
      input.value = day; summary.textContent = `${label} · ${day}`; picker.open = false;
    } }));
  }
  clear.addEventListener("click", () => { input.value = ""; draw(); picker.open = false; });
  body.append(calendar, clear); picker.append(summary, body); draw(); return picker;
}
function labeled(title, input) {
  const label = element("label", "stats-control-label", title); label.append(input); return label;
}
function select(name, options, selected) {
  const input = element("select", "stats-select"); input.name = name;
  for (const [value, title] of options) { const option = element("option", "", title); option.value = value; input.append(option); }
  if (options.some(([value]) => value === selected)) input.value = selected;
  return input;
}
function matchLink(match) {
  const link = element("a", "stats-player-link", `Матч #${match.dota_match_id ?? match.id}`);
  const id = matchID(match.id); if (id) link.href = `/match?id=${encodeURIComponent(id)}`;
  return link;
}
function progressiveList(root, items, render) {
  const list = element("ul", "match-list");
  const more = element("button", "button button-quiet", "Показать ещё 20"); more.type = "button";
  let visible = 20;
  function draw() { list.replaceChildren(...items.slice(0, visible).map(render)); more.hidden = visible >= items.length; }
  more.addEventListener("click", () => { visible += 20; draw(); }); root.append(list, more); draw();
}
function recordPanels(root, data, ui) {
  const labels = { ...playerRecordLabels, longest: "Самый длинный матч", shortest: "Самый короткий матч" };
  const incomplete = new Set(["gold_per_min", "xp_per_min", "net_worth", "hero_healing", "damage_per_min"]);
  const grid = element("div", "stats-grid"); root.append(grid);
  for (const [key, title] of Object.entries(labels)) {
    const panel = element("section", "panel insight-record");
    panel.append(element("h2", "", title));
    if (incomplete.has(key)) panel.append(element("p", "record-data-note muted small", "Данные могут быть неточными: часть информации о матчах отсутствует."));
    const rows = data[key];
    if (!rows.length) { panel.append(element("p", "muted", "Нет данных")); grid.append(panel); continue; }
    panel.append(element("p", "stat-value", key === "longest" || key === "shortest" ? duration(rows[0].value) : decimal(rows[0].value)));
    progressiveList(panel, rows, record => {
      const row = element("li", "record-entry");
      if (record.player) row.append(ui.playerLink({ id: record.player.account_id, name: record.player.nickname || `ID ${record.player.account_id}` }), heroBadge(record.player));
      row.append(matchLink(record.match), element("span", "muted small", date(record.match.started_at))); return row;
    });
    grid.append(panel);
  }
}

export function renderInsights(matches, data, root, ui) {
  const params = new URLSearchParams(location.search);
  const section = Object.hasOwn(sections, params.get("section")) ? params.get("section") : "compare";
  const nav = element("nav", "insight-nav"); nav.setAttribute("aria-label", "Аналитика матчей");
  for (const [id, name] of Object.entries(sections)) {
    const link = element("a", "", name); link.href = `/?view=insights&section=${id}`;
    if (id === section) link.setAttribute("aria-current", "page"); nav.append(link);
  }
  root.append(nav);
  const players = [...data.players.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selectedId = params.get("account_id") || players[0]?.id;
  const chosen = data.players.get(selectedId) || players[0];
  const form = element("form", "stats-controls insight-controls"); form.method = "get"; form.action = "/";
  for (const [name, value] of [["view", "insights"], ["section", section]]) {
    const input = element("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
  }
  function applyForm() { const apply = element("button", "button", "Показать"); apply.type = "submit"; form.append(apply); root.append(form); }
  if (["compare", "rivals"].includes(section) && !players.length) {
    root.append(element("p", "notice", "В сохранённых матчах нет игроков с известным Account ID.")); return;
  }
  if (section === "compare") {
    const pickers = element("div", "comparison-players"); root.append(pickers);
    function comparisonPlayer(name, label, value) {
      const input = element("input"); input.type = "hidden"; input.name = name;
      input.value = data.players.has(value) ? value : players[0].id; form.append(input);
      const host = element("div", "comparison-picker"); pickers.append(host);
      if (ui.chooseComparisonPlayer) ui.chooseComparisonPlayer(host, {
        selectedId: input.value, idPrefix: `compare-${name}`, label,
        onSelect(player) { input.value = player.id; },
      });
      else host.append(element("p", "", `${label} · ${data.players.get(input.value).name}`));
      return input;
    }
    const left = comparisonPlayer("account_id", "Первый игрок", chosen.id);
    const right = comparisonPlayer("other_id", "Второй игрок", params.get("other_id") || players[1]?.id || chosen.id);
    const heroOptions = [["", "Все герои"], ...[...data.heroes.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")).map(hero => [String(hero.hero_id), hero.name])];
    const hero = select("hero_id", heroOptions, params.get("hero_id") || ""); form.append(labeled("Герой обоих игроков", hero));
    const from = element("input", "stats-select"), to = element("input", "stats-select");
    from.type = to.type = "hidden"; from.name = "from"; to.name = "to";
    from.value = calendarDate(params.get("from")) ? params.get("from") : "";
    to.value = calendarDate(params.get("to")) ? params.get("to") : "";
    form.append(from, to, rangeCalendar(matches, from, "С даты"), rangeCalendar(matches, to, "По дату включительно")); applyForm();
    if (from.value && to.value && from.value > to.value) { root.append(element("p", "notice", "Начало периода должно быть не позже окончания.")); return; }
    const summary = summarizePlayers(matchesInRange(matches, from.value, to.value), hero.value);
    const a = summary.get(left.value), b = summary.get(right.value);
    const metric = (row, key) => ui.sortedValue(row?.averages[key], `${decimal(row?.averages[key])} · игр: ${row?.samples[key] || 0}`);
    const entries = [["Матчей", a?.games || 0, b?.games || 0], ["Побед", a?.wins || 0, b?.wins || 0],
      ["Поражений", a ? a.decided - a.wins : 0, b ? b.decided - b.wins : 0], ["Винрейт", ui.rateCell(a?.wins || 0, a?.decided || 0), ui.rateCell(b?.wins || 0, b?.decided || 0)],
      ...Object.entries(metricLabels).map(([key, label]) => [`${label} · среднее`, metric(a, key), metric(b, key)])];
    root.append(ui.statsTable("Сравнение игроков", ["Показатель", data.players.get(left.value)?.name || "Первый игрок", data.players.get(right.value)?.name || "Второй игрок"], entries,
      "Период общий, календарные даты — по часовому поясу браузера. Среднее считается отдельно по играм с известным показателем; количество указано в ячейке. Неизвестные результаты исключены из винрейта. Матчи игроков могут различаться."));
  } else if (section === "rivals") {
    const player = ui.choosePlayer ? ui.choosePlayer(root) : chosen;
    if (!player) return;
    const account = element("input"); account.type = "hidden"; account.name = "account_id"; account.value = player.id; form.append(account);
    const minimum = select("min_games", [1, 3, 5, 10].map(value => [String(value), String(value)]), params.get("min_games") || "1");
    form.append(labeled("Минимум игр против друг друга", minimum)); applyForm();
    const rivals = rivalries(matches, player.id).filter(row => row.games >= Number(minimum.value));
    root.append(ui.statsTable(`Противостояния · ${player.name}`, ["Соперник", "Игр", "Побед игрока", "Побед соперника", "Без результата", "Винрейт игрока"], rivals.map(row =>
      [ui.sortedValue(row.name, ui.playerLink(row)), row.games, row.wins, row.decided - row.wins, row.games - row.decided, ui.rateCell(row.wins, row.decided)]),
    "Учитываются только матчи, где игроки были в разных известных командах. Винрейт указан с точки зрения выбранного игрока.", [{ column: 1, descending: true }]));
  } else if (section === "records") {
    root.append(element("p", "muted", "Рекорды известных игроков в сохранённых матчах. Для урона в минуту нужна известная положительная длительность."));
    recordPanels(root, records(matches), ui);
  } else if (section === "evening") {
    const day = calendarDay(matches, params.get("day"));
    root.append(renderMatchCalendar(matches, day));
    const summary = dailySummary(matches, day);
    root.append(element("h2", "insight-heading", `${day} · Матчей: ${number(summary.matches.length)}`));
    root.append(ui.statsTable("Результаты участников", ["Игрок", "Игр", "Побед", "Поражений", "Без результата", "Винрейт", "Серия побед", "Серия поражений"], summary.players.map(row =>
      [ui.sortedValue(row.name, ui.playerLink(row)), row.games, row.wins, row.decided - row.wins, row.games - row.decided, ui.rateCell(row.wins, row.decided), row.bestWins, row.bestLosses]),
      "Максимальные серии внутри выбранного календарного дня. Неизвестный результат прерывает серию. Анонимные игроки не объединяются.", [{ column: 1, descending: true }]));
    if (summary.matches.length) { recordPanels(root, summary.records, ui); root.append(element("h2", "insight-heading", "Матчи дня")); progressiveList(root, summary.matches, ui.renderMatch); }
    root.append(ui.statsTable("Герои дня", ["Герой", "Игр известных игроков"], summary.heroes.map(row => [ui.sortedValue(row.hero.hero_name || String(row.hero.hero_id), heroBadge(row.hero)), row.games]), "Выборы героев участниками с известным Account ID.", [{ column: 1, descending: true }]));
  } else {
    root.append(element("p", "notice", "Избранное и заметки хранятся только в этом браузере. Очистка данных сайта удалит их. Добавить матч можно в истории или на странице матча."));
    const host = element("div"), announcement = element("p", "muted small"); announcement.setAttribute("role", "status"); root.append(announcement, host);
    function refresh() { announcement.textContent = "Избранное обновлено."; drawFavorites(); }
    function drawFavorites() {
      host.replaceChildren();
      try {
        const saved = readFavorites(), byId = new Map(matches.map(match => [match.id, match]));
        const ids = Object.keys(saved);
        if (!ids.length) host.append(element("p", "muted", "Избранных матчей пока нет."));
        progressiveList(host, ids, id => {
          const match = byId.get(id), row = match ? ui.renderMatch(match, { onFavoriteChange: refresh }) : element("li", "panel record-entry");
          if (!match) row.append(matchLink({ id }), element("p", "muted", "Матч отсутствует в текущей выборке."), favoriteEditor(id, refresh));
          if (saved[id].note) row.append(element("p", "favorite-saved-note", saved[id].note));
          return row;
        });
      } catch { host.append(element("p", "notice", "Избранное недоступно: проверьте доступ к хранилищу браузера. Существующие данные не изменены.")); }
    }
    drawFavorites();
  }
}
