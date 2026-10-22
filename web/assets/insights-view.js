import { element, number, duration, date, heroBadge, matchID } from "./common.js";
import { metricLabels, summarizePlayers, rivalries, records, durationStats, dailySummary, localDay, matchesInRange } from "./insights.js";
import { readFavorites, favoriteEditor } from "./favorites.js";

const decimal = value => value == null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const sections = { compare: "Сравнение", rivals: "Противостояния", records: "Рекорды", evening: "Итоги дня", duration: "Длительность", favorites: "Избранное" };
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
  const labels = { kills: "Рекорд убийств", assists: "Рекорд помощи", hero_healing: "Рекорд лечения", damage_per_min: "Рекорд урона героям в минуту", longest: "Самый длинный матч", shortest: "Самый короткий матч" };
  const grid = element("div", "stats-grid"); root.append(grid);
  for (const [key, title] of Object.entries(labels)) {
    const panel = element("section", "panel insight-record");
    panel.append(element("h2", "", title));
    const rows = data[key];
    if (!rows.length) { panel.append(element("p", "muted", "Нет данных")); grid.append(panel); continue; }
    panel.append(element("p", "stat-value", key === "longest" || key === "shortest" ? duration(rows[0].value) : decimal(rows[0].value)),
      element("p", "muted small", `Совпадений рекорда: ${rows.length}`));
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
  const nav = element("nav", "section-nav insight-nav"); nav.setAttribute("aria-label", "Аналитика матчей");
  for (const [id, name] of Object.entries(sections)) {
    const link = element("a", "", name); link.href = `/?view=insights&section=${id}`;
    if (id === section) link.setAttribute("aria-current", "page"); nav.append(link);
  }
  root.append(nav);
  const players = [...data.players.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const playerOptions = players.map(player => [player.id, `${player.name} · ID ${player.id}`]);
  const selectedId = params.get("account_id") || players[0]?.id;
  const chosen = data.players.get(selectedId) || players[0];
  const form = element("form", "stats-controls insight-controls"); form.method = "get"; form.action = "/";
  for (const [name, value] of [["view", "insights"], ["section", section]]) {
    const input = element("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
  }
  function addPicker(name, label, value = chosen?.id) { const input = select(name, playerOptions, value); form.append(labeled(label, input)); return input; }
  function applyForm() { const apply = element("button", "button", "Показать"); apply.type = "submit"; form.append(apply); root.append(form); }
  if (["compare", "rivals", "duration"].includes(section) && !players.length) {
    root.append(element("p", "notice", "В сохранённых матчах нет игроков с известным Account ID.")); return;
  }
  if (section === "compare") {
    const left = addPicker("account_id", "Первый игрок");
    const right = addPicker("other_id", "Второй игрок", params.get("other_id") || players[1]?.id || chosen.id);
    const heroOptions = [["", "Все герои"], ...[...data.heroes.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")).map(hero => [String(hero.hero_id), hero.name])];
    const hero = select("hero_id", heroOptions, params.get("hero_id") || ""); form.append(labeled("Герой обоих игроков", hero));
    const from = element("input", "stats-select"), to = element("input", "stats-select");
    from.type = to.type = "date"; from.name = "from"; to.name = "to";
    from.value = params.get("from") || ""; to.value = params.get("to") || "";
    form.append(labeled("С даты", from), labeled("По дату включительно", to)); applyForm();
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
    addPicker("account_id", "Игрок");
    const minimum = select("min_games", [1, 3, 5, 10].map(value => [String(value), String(value)]), params.get("min_games") || "1");
    form.append(labeled("Минимум игр против друг друга", minimum)); applyForm();
    const rivals = rivalries(matches, chosen.id).filter(row => row.games >= Number(minimum.value));
    root.append(ui.statsTable(`Противостояния · ${chosen.name}`, ["Соперник", "Игр", "Побед игрока", "Побед соперника", "Без результата", "Винрейт игрока"], rivals.map(row =>
      [ui.sortedValue(row.name, ui.playerLink(row)), row.games, row.wins, row.decided - row.wins, row.games - row.decided, ui.rateCell(row.wins, row.decided)]),
    "Учитываются только матчи, где игроки были в разных известных командах. Винрейт указан с точки зрения выбранного игрока.", [{ column: 1, descending: true }]));
  } else if (section === "records") {
    root.append(element("p", "muted", "Рекорды известных игроков в сохранённых матчах. Все совпадения доступны в списках. Для урона в минуту нужна известная положительная длительность."));
    recordPanels(root, records(matches), ui);
  } else if (section === "evening") {
    const day = element("input", "stats-select"); day.type = "date"; day.name = "day";
    day.value = params.get("day") || matches.map(match => localDay(match.started_at)).find(Boolean) || localDay(new Date());
    form.append(labeled("Игровой день · местное время", day)); applyForm();
    const summary = dailySummary(matches, day.value);
    root.append(element("h2", "insight-heading", `${day.value} · Матчей: ${number(summary.matches.length)}`));
    root.append(ui.statsTable("Результаты участников", ["Игрок", "Игр", "Побед", "Поражений", "Без результата", "Винрейт", "Серия побед", "Серия поражений"], summary.players.map(row =>
      [ui.sortedValue(row.name, ui.playerLink(row)), row.games, row.wins, row.decided - row.wins, row.games - row.decided, ui.rateCell(row.wins, row.decided), row.bestWins, row.bestLosses]),
      "Максимальные серии внутри выбранного календарного дня. Неизвестный результат прерывает серию. Анонимные игроки не объединяются.", [{ column: 1, descending: true }]));
    root.append(ui.statsTable("Герои дня", ["Герой", "Игр известных игроков"], summary.heroes.map(row => [ui.sortedValue(row.hero.hero_name || String(row.hero.hero_id), heroBadge(row.hero)), row.games]), "Выборы героев участниками с известным Account ID.", [{ column: 1, descending: true }]));
    if (summary.matches.length) { recordPanels(root, summary.records, ui); root.append(element("h2", "insight-heading", "Матчи дня")); progressiveList(root, summary.matches, ui.renderMatch); }
  } else if (section === "duration") {
    addPicker("account_id", "Игрок"); applyForm();
    root.append(ui.statsTable(`Длительность · ${chosen.name}`, ["Герой", "Длительность", "Игр", "Побед", "Без результата", "Винрейт"], durationStats(matches, chosen.id).map(row =>
      [ui.sortedValue(row.hero.hero_name || String(row.hero.hero_id), heroBadge(row.hero)), ui.sortedValue(row.bucket, row.label), row.games, row.wins, row.games - row.decided, ui.rateCell(row.wins, row.decided)]),
      "До 30:00; от 30:00 до 44:59; от 45:00. Матчи без положительной известной длительности исключены. Винрейт зависит от размера выборки.", [{ column: 0, descending: false }, { column: 1, descending: false }]));
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
