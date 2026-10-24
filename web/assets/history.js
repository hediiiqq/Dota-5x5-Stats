import { element, image, heroBadge, number, steamProfileURL, date, duration, winner, offsetFromURL, historyPageSize, historyPageSizeFromURL, saveHistoryPageSize, historyPageURL, matchID, requestJSON, showStatus, showLoading, animateSurface } from "./common.js";
import { itemInfo } from "./items.js";
import { renderInsights } from "./insights-view.js";
import { favoriteEditor } from "./favorites.js";

const limit = historyPageSizeFromURL();
const offset = offsetFromURL();
const status = document.querySelector("#status");
const content = document.querySelector("#history-content");
const rows = document.querySelector("#matches");
const count = document.querySelector("#match-count");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
let controller;
const params = new URLSearchParams(location.search);
const requestedView = params.get("view");
const view = ["stats", "player", "allies", "insights", "balancer"].includes(requestedView) ? requestedView : "history";

// Keep reload, back navigation and copied page URLs on the same valid offset.
if (view === "history") {
  history.replaceState(null, "", historyPageURL(offset, limit));
  saveHistoryPageSize(limit);
}
const pageSize = document.querySelector("#page-size");
pageSize.value = String(limit);
pageSize.addEventListener("change", () => {
  const size = historyPageSize(pageSize.value);
  saveHistoryPageSize(size);
  location.assign(historyPageURL(0, size));
});
document.querySelector("#page-number").textContent = `Страница ${Math.floor(offset / limit) + 1}`;
document.querySelector("#history-title").textContent = offset ? "История игр" : "Последние игры";

function pageLink(link, target, enabled) {
  link.setAttribute("aria-disabled", String(!enabled));
  if (enabled) link.href = historyPageURL(target, limit);
  else link.removeAttribute("href");
}

function renderTeam(match, side, players) {
  const root = element("div", `history-team ${side}`);
  const label = element("div", "history-team-label");
  const sideName = side === "radiant" ? "Radiant" : side === "dire" ? "Dire" : "Сторона неизвестна";
  const name = match[`${side}_team_name`] || sideName;
  label.title = `${sideName} · ${name}`;
  const logo = image(match[`${side}_team_logo_url`], "history-team-logo", "", 18);
  if (logo) label.append(logo);
  label.append(element("span", "", name));
  const heroes = element("ul", "history-heroes");
  heroes.setAttribute("aria-label", `Герои ${sideName}`);
  for (const player of players) {
    const name = player.hero_name || (player.hero_id == null ? "Герой неизвестен" : `Герой #${player.hero_id}`);
    const slot = element("li", "history-hero");
    slot.title = player.nickname ? `${name} · ${player.nickname}` : name;
    slot.append(element("span", "sr-only", slot.title));
    const fallback = element("span", "history-hero-fallback", player.hero_id == null ? "?" : `#${player.hero_id}`);
    fallback.setAttribute("aria-hidden", "true");
    slot.append(fallback);
    const url = typeof player.hero_icon_url === "string" ? player.hero_icon_url.replace("/heroes/icons/", "/heroes/") : null;
    const icon = image(url, "history-hero-image", "", 40);
    if (icon) { icon.height = 24; slot.append(icon); }
    heroes.append(slot);
  }
  root.append(label);
  if (players.length) root.append(heroes);
  else root.append(element("span", "muted small", "Нет данных о героях"));
  return root;
}

function renderMatch(match, options = {}) {
  const row = element("li", "history-entry");
  const card = element("article", "history-match");
  const info = element("div", "history-info");
  info.append(element("h3", "history-match-id", `Матч #${match.dota_match_id ?? "—"}`),
    element("span", "history-date", date(match.started_at)),
    element("span", "history-mode", match.game_mode_name || (Number.isInteger(match.game_mode) ? `Режим #${match.game_mode}` : "Режим неизвестен")));
  const teams = element("div", "history-lineups");
  const players = Array.isArray(match.players) ? match.players.filter(player => player && typeof player === "object") : [];
  teams.append(renderTeam(match, "radiant", players.filter(player => player.side === "radiant")),
    renderTeam(match, "dire", players.filter(player => player.side === "dire")));
  const unknown = players.filter(player => player.side !== "radiant" && player.side !== "dire");
  if (unknown.length) teams.append(renderTeam(match, "unknown", unknown));
  const result = element("div", "history-result");
  result.append(element("span", "muted small", "Победитель"), winner(match.winner));
  const time = element("span", "history-duration mono", duration(match.duration));
  time.setAttribute("aria-label", `Длительность матча: ${duration(match.duration)}`);
  result.append(time);
  const action = element("div", "history-action");
  const id = matchID(match.id);
  if (id) {
    const link = element("a", "button match-link", "Открыть матч →");
    link.href = `/match?id=${encodeURIComponent(id)}&offset=${offset}&limit=${limit}`;
    link.setAttribute("aria-label", `Открыть матч ${match.dota_match_id ?? id}`);
    action.append(link);
  } else action.textContent = "—";
  card.append(info, teams, result, action);
  row.append(card);
  row.append(favoriteEditor(id, options.onFavoriteChange));
  return row;
}

async function load() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  content.hidden = true;
  count.textContent = "";
  pageLink(previous, Math.max(0, offset - limit), offset > 0);
  pageLink(next, offset + limit, false);
  showLoading(status, "Загружаем историю…");
  try {
    const matches = await requestJSON(`/api/matches?limit=${limit}&offset=${offset}`, signal);
    if (signal.aborted) return;
    if (!Array.isArray(matches) || matches.some(match => !match || typeof match !== "object")) {
      throw new Error("Сервер вернул некорректный список матчей.");
    }
    rows.replaceChildren(...matches.map(renderMatch));
    count.textContent = `Показано: ${matches.length}`;
    pageLink(next, offset + limit, matches.length === limit);
    if (!matches.length) {
      showStatus(status, offset ? "На этой странице матчей нет" : "Матчей пока нет",
        offset ? "Вернитесь на предыдущую страницу истории." : "Сохранённые матчи появятся здесь после импорта.");
      return;
    }
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    if (!signal.aborted) showStatus(status, "Не удалось загрузить историю", error.message, load);
  }
}

addEventListener("pagehide", () => controller?.abort());
addEventListener("pageshow", event => {
  if (event.persisted && controller?.signal.aborted) start();
});

const excludedItems = new Set(["tpscroll", "ward_observer", "ward_sentry", "ward_dispenser", "recipe_ward_dispenser", "smoke_of_deceit"]);
const isSide = side => side === "radiant" || side === "dire";
const percentage = (wins, games) => games ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(wins / games * 100)}%` : "—";
const ranked = records => [...records.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), "ru"));

function heroRecord(map, hero) {
  if (!Number.isInteger(hero.hero_id) || hero.hero_id <= 0) return null;
  if (!map.has(hero.hero_id)) map.set(hero.hero_id, {
    hero_id: hero.hero_id, hero_name: hero.hero_name, hero_icon_url: hero.hero_icon_url,
    name: hero.hero_name || `Герой #${hero.hero_id}`, count: 0, wins: 0, decided: 0,
  });
  return map.get(hero.hero_id);
}

export function buildStatistics(matches) {
  const result = { matches: matches.length, heroes: new Map(), bans: new Map(), players: new Map(), draftMatches: 0, playerMatches: 0, anonymous: 0 };
  for (const match of matches) {
    const players = Array.isArray(match.players) ? match.players.filter(p => p && typeof p === "object") : [];
    if (players.length) result.playerMatches++;
    const picked = new Set();
    const accounts = new Map();
    for (const player of players) {
      const hero = heroRecord(result.heroes, player);
      if (hero && !picked.has(player.hero_id)) { hero.count++; picked.add(player.hero_id); }
      if (!steamProfileURL(player.account_id)) { result.anonymous++; continue; }
      if (accounts.has(player.account_id)) continue;
      accounts.set(player.account_id, player);
      if (!result.players.has(player.account_id)) result.players.set(player.account_id, {
        id: player.account_id, name: player.nickname || `ID ${player.account_id}`,
        avatar_url: player.avatar_url, count: 0, wins: 0, decided: 0, inventoryGames: 0, heroes: new Map(), items: new Map(), allies: new Map(),
      });
      const record = result.players.get(player.account_id);
      const decided = isSide(match.winner) && isSide(player.side);
      const won = decided && match.winner === player.side;
      record.count++;
      record.decided += Number(decided);
      record.wins += Number(won);
      const ownHero = heroRecord(record.heroes, player);
      if (ownHero) {
        ownHero.count++; ownHero.decided += Number(decided); ownHero.wins += Number(won);
        (ownHero.matches ??= []).push(match);
      }
      const inventory = Array.from({ length: 11 }, (_, index) => player[`item_${index}`]);
      if (inventory.some(id => Number.isInteger(id) && id >= 0)) record.inventoryGames++;
      for (const id of new Set(inventory)) {
        if (!Number.isInteger(id) || id <= 0) continue;
        const info = itemInfo(id);
        if (info && excludedItems.has(info[1])) continue;
        if (!record.items.has(id)) record.items.set(id, { id, name: info?.[0] || `Предмет #${id}`, slug: info?.[1], count: 0, wins: 0, decided: 0 });
        const item = record.items.get(id);
        item.count++;
        item.wins += Number(won);
        item.decided += Number(decided);
      }
    }
    for (const [id, player] of accounts) {
      if (!isSide(player.side)) continue;
      const record = result.players.get(id);
      for (const [allyID, ally] of accounts) {
        if (id === allyID || player.side !== ally.side) continue;
        if (!record.allies.has(allyID)) record.allies.set(allyID, { id: allyID, name: result.players.get(allyID).name, count: 0, wins: 0, decided: 0 });
        const pair = record.allies.get(allyID);
        pair.count++;
        pair.decided += Number(isSide(match.winner));
        pair.wins += Number(match.winner === player.side);
      }
    }
    const draft = Array.isArray(match.picks_bans) ? match.picks_bans : [];
    if (draft.length) result.draftMatches++;
    const banned = new Set();
    for (const entry of draft) {
      if (!entry || entry.is_pick !== false) continue;
      const hero = heroRecord(result.bans, entry);
      if (hero && !banned.has(entry.hero_id)) { hero.count++; banned.add(entry.hero_id); }
    }
  }
  return result;
}

export async function fetchStatisticsMatches(signal, progress) {
  const matches = [];
  const seen = new Set();
  for (let offset = 0; ; offset += 100) {
    const page = await requestJSON(`/api/matches?limit=100&offset=${offset}`, signal);
    if (!Array.isArray(page) || page.length > 100 || page.some(match => !match || !matchID(match.id))) throw new Error("Некорректный список матчей. Статистика не рассчитана.");
    for (const match of page) {
      if (seen.has(match.id)) throw new Error("Список матчей изменился во время загрузки. Повторите загрузку статистики.");
      seen.add(match.id);
      matches.push(match);
    }
    progress?.(matches.length);
    if (page.length < 100) break;
  }
  // Detect a shifted newest page during imports; the API has no snapshot token.
  if (matches.length) {
    const latest = await requestJSON("/api/matches?limit=1&offset=0", signal);
    if (!Array.isArray(latest) || latest[0]?.id !== matches[0].id) throw new Error("База обновилась во время загрузки. Повторите загрузку статистики.");
  }
  return matches;
}

function statisticCard(label, value, note) {
  const card = element("div", "stat-card");
  card.append(element("span", "stat-label", label), element("div", "stat-value", value));
  if (note) card.append(element("span", "muted small", note));
  return card;
}

const sortedValue = (value, content) => ({ value, content });
const rateCell = (wins, games) => sortedValue(games ? wins / games : null, percentage(wins, games));

export function compareStatisticsValues(left, right, descending = false) {
  const missing = value => value == null || (typeof value === "number" && !Number.isFinite(value));
  if (missing(left) || missing(right)) return missing(left) ? missing(right) ? 0 : 1 : -1;
  const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ru", { numeric: true });
  return descending ? -result : result;
}

function statsTable(title, headers, entries, note, initialSort = []) {
  const panel = element("section", "panel stats-table-panel");
  const heading = element("div", "panel-heading"); heading.append(element("h2", "", title)); panel.append(heading);
  if (note) panel.append(element("p", "stats-explanation muted small", note));
  if (!entries.length) { panel.append(element("p", "stats-explanation muted", "Нет данных для расчёта.")); return panel; }
  const scroll = element("div", "table-scroll"); scroll.tabIndex = 0;
  scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", title);
  const table = element("table", "stats-table");
  table.append(element("caption", "sr-only", title));
  const criteria = initialSort.map(rule => ({ ...rule }));
  const controls = [];
  const priorities = element("ol", "sort-priorities");
  const tools = element("div", "stats-sort-tools");
  tools.append(element("p", "muted small", "Нажимайте заголовки: новый столбец добавляет критерий, повторное нажатие меняет направление. Приоритеты применяются слева направо."), priorities);
  const reset = element("button", "button button-quiet", "Сбросить сортировку"); reset.type = "button"; tools.append(reset);
  const announcement = element("p", "sr-only"); announcement.setAttribute("role", "status"); tools.append(announcement);
  panel.append(tools);
  const head = element("thead"), row = element("tr");
  headers.forEach((label, column) => {
    const th = element("th"); th.scope = "col";
    const button = element("button", "stats-sort-button", label); button.type = "button";
    const indicator = element("span", "stats-sort-indicator"); indicator.setAttribute("aria-hidden", "true"); button.append(indicator);
    button.addEventListener("click", () => {
      const current = criteria.find(rule => rule.column === column);
      if (current) current.descending = !current.descending;
      else criteria.push({ column, descending: column !== 0 });
      applySort();
    });
    controls.push({ th, button, indicator }); th.append(button); row.append(th);
  });
  head.append(row); table.append(head);
  const body = element("tbody");
  const records = entries.map((values, index) => {
    const tr = element("tr");
    values.forEach((value, column) => {
      const cell = element(column ? "td" : "th", column ? "mono" : "stats-row-name");
      if (!column) cell.scope = "row";
      const content = value && typeof value === "object" && "content" in value ? value.content : typeof value === "number" ? number(value) : value;
      if (typeof content === "object" && content) cell.append(content);
      else cell.textContent = content ?? "—";
      tr.append(cell);
    });
    body.append(tr);
    return { tr, index, values: values.map(value => value && typeof value === "object" && "value" in value ? value.value : value) };
  });
  function applySort() {
    const sorted = [...records].sort((a, b) => {
      for (const rule of criteria) {
        const difference = compareStatisticsValues(a.values[rule.column], b.values[rule.column], rule.descending);
        if (difference) return difference;
      }
      return a.index - b.index;
    });
    for (const record of sorted) body.append(record.tr);
    priorities.replaceChildren();
    controls.forEach(({ th, button, indicator }, column) => {
      const index = criteria.findIndex(rule => rule.column === column), rule = criteria[index];
      th.removeAttribute("aria-sort");
      if (index === 0) th.setAttribute("aria-sort", rule.descending ? "descending" : "ascending");
      button.setAttribute("aria-pressed", String(index !== -1));
      button.setAttribute("aria-label", `${headers[column]}: ${rule ? `приоритет ${index + 1}, ${rule.descending ? "по убыванию" : "по возрастанию"}; изменить направление` : "добавить критерий сортировки"}`);
      indicator.textContent = rule ? ` ${index + 1}${rule.descending ? "↓" : "↑"}` : " ↕";
    });
    criteria.forEach((rule, index) => {
      const item = element("li", "sort-priority");
      item.append(element("span", "", `${index + 1}. ${headers[rule.column]} ${rule.descending ? "↓" : "↑"}`));
      const up = element("button", "sort-priority-action", "←"); up.type = "button"; up.disabled = index === 0;
      up.setAttribute("aria-label", `Повысить приоритет: ${headers[rule.column]}`);
      up.addEventListener("click", () => { if (index > 0) { [criteria[index - 1], criteria[index]] = [criteria[index], criteria[index - 1]]; applySort(); controls[rule.column].button.focus(); } });
      const remove = element("button", "sort-priority-action", "×"); remove.type = "button";
      remove.setAttribute("aria-label", `Убрать сортировку: ${headers[rule.column]}`);
      remove.addEventListener("click", () => { criteria.splice(index, 1); applySort(); controls[rule.column].button.focus(); });
      item.append(up, remove); priorities.append(item);
    });
    reset.disabled = !criteria.length;
    announcement.textContent = criteria.length ? `Сортировка: ${criteria.map(rule => `${headers[rule.column]} ${rule.descending ? "по убыванию" : "по возрастанию"}`).join(", затем ")}` : "Исходный порядок строк";
  }
  reset.addEventListener("click", () => { criteria.length = 0; applySort(); controls[0].button.focus(); });
  applySort();
  table.append(body); scroll.append(table); panel.append(scroll); return panel;
}

function playerLink(record) {
  const link = element("a", "stats-player-link stats-player-identity");
  link.append(playerAvatar(record));
  const text = element("span", "stats-player-text"); text.append(element("span", "", record.name), element("span", "muted small", `ID ${record.id}`)); link.append(text);
  link.href = `/?view=player&account_id=${encodeURIComponent(record.id)}`;
  return link;
}

const avatarCache = new Map();
const avatarPending = new Map();
const avatarImages = new WeakSet();

function playerAvatar(record) {
  const avatar = element("span", "player-avatar stats-avatar", Array.from(record.name || "?")[0].toUpperCase());
  avatar.setAttribute("aria-hidden", "true");
  avatar.setAttribute("data-avatar-account", record.id);
  const icon = image(record.avatar_url || avatarCache.get(record.id), "avatar-image", "", 32);
  if (icon) { avatar.append(icon); avatarImages.add(avatar); }
  return avatar;
}

async function loadStatsAvatars(root, signal) {
  const slots = [...root.querySelectorAll("[data-avatar-account]")];
  const ids = [...new Set(slots.map(slot => slot.getAttribute("data-avatar-account")))];
  const needed = ids.filter(id => !avatarCache.has(id) && !avatarPending.has(id));
  const jobs = new Set(ids.map(id => avatarPending.get(id)).filter(Boolean));
  for (let index = 0; index < needed.length; index += 10) {
    const batch = needed.slice(index, index + 10);
    const job = requestJSON(`/api/players/avatars?account_ids=${batch.join(",")}`, signal).then(response => {
      if (!signal.aborted) for (const id of batch) avatarCache.set(id, response?.avatars?.[id] || null);
    }).catch(() => {}).finally(() => { for (const id of batch) avatarPending.delete(id); });
    for (const id of batch) avatarPending.set(id, job);
    jobs.add(job);
  }
  await Promise.all(jobs);
  if (signal.aborted) return;
  for (const slot of slots) {
    if (avatarImages.has(slot)) continue;
    const icon = image(avatarCache.get(slot.getAttribute("data-avatar-account")), "avatar-image", "", 32);
    if (icon) { slot.append(icon); avatarImages.add(slot); }
  }
}

function renderGeneralStats(data, root) {
  const summary = element("div", "stats-summary");
  const heroes = ranked(data.heroes), bans = ranked(data.bans);
  summary.append(statisticCard("Сохранённых матчей", number(data.matches)),
    statisticCard("Популярный герой", heroes[0]?.name || "—", heroes[0] ? `${heroes[0].count} матчей` : "Нет данных"),
    statisticCard("Чаще всего в бане", bans[0]?.name || "—", bans[0] ? `${bans[0].count} матчей` : "Нет записей о банах"));
  root.append(summary);
  const grid = element("div", "stats-grid");
  grid.append(statsTable("Популярные герои", ["Герой", "Матчей", "Доля"], heroes.map(hero => [sortedValue(hero.name, heroBadge(hero)), hero.count, rateCell(hero.count, data.playerMatches)]), `Герои из составов команд. Матчей с данными об игроках: ${data.playerMatches}. Герой учитывается один раз в матче.`, [{ column: 1, descending: true }]),
    statsTable("Самые частые баны", ["Герой", "Матчей с баном"], bans.map(hero => [sortedValue(hero.name, heroBadge(hero)), hero.count]), `Матчей с записями драфта: ${data.draftMatches} из ${data.matches}. Отсутствующий драфт не считается отсутствием банов.`, [{ column: 1, descending: true }]));
  root.append(grid);
}

function renderPlayerChoice(data, root, options = {}) {
  const players = ranked(data.players);
  if (!players.length) { root.append(element("p", "notice", "Нет игроков с известным Account ID. Анонимные игроки не объединяются между матчами.")); return null; }
  const requestedId = options.selectedId ?? params.get("account_id");
  let player = data.players.get(requestedId) || players[0];
  const picker = element("details", "player-picker panel");
  picker.open = !options.onSelect && (!params.has("account_id") || !data.players.has(params.get("account_id")));
  const summary = element("summary", "player-picker-heading", `${options.label || "Выбрать игрока"} · ${player.name}`); picker.append(summary);
  const tools = element("div", "player-picker-tools");
  const label = element("label", "stats-control-label", "Поиск по нику или Account ID"); label.htmlFor = `${options.idPrefix || "player"}-search`;
  const search = element("input", "stats-select player-search"); search.type = "search"; search.id = label.htmlFor;
  search.placeholder = "Введите ник или ID"; search.autocomplete = "off"; label.append(search);
  const sortLabel = element("label", "stats-control-label", "Порядок игроков"); sortLabel.htmlFor = `${options.idPrefix || "player"}-order`;
  const sort = element("select", "stats-select"); sort.id = sortLabel.htmlFor;
  for (const [value, text] of [["games-desc", "Игр: больше сначала"], ["games-asc", "Игр: меньше сначала"], ["name-asc", "Имя: А → Я"], ["name-desc", "Имя: Я → А"], ["rate-desc", "Винрейт: выше сначала"], ["rate-asc", "Винрейт: ниже сначала"]]) {
    const option = element("option", "", text); option.value = value; sort.append(option);
  }
  sort.value = "games-desc"; sortLabel.append(sort); tools.append(label, sortLabel); picker.append(tools);
  const found = element("p", "player-search-count muted small"); found.setAttribute("role", "status");
  const list = element("ul", "player-search-list"); list.setAttribute("aria-label", "Найденные игроки");
  const more = element("button", "button button-quiet player-search-more", "Показать ещё 20"); more.type = "button";
  let visible = 20;
  function renderChoices() {
    const query = search.value.trim().toLocaleLowerCase("ru");
    const [key, direction] = sort.value.split("-");
    const choices = players.filter(record => record.name.toLocaleLowerCase("ru").includes(query) || record.id.includes(query)).sort((a, b) => {
      const value = record => key === "name" ? record.name : key === "rate" ? record.decided ? record.wins / record.decided : null : record.count;
      return compareStatisticsValues(value(a), value(b), direction === "desc") || a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id);
    });
    list.replaceChildren();
    for (const record of choices.slice(0, visible)) {
      const row = element("li");
      const link = element(options.onSelect ? "button" : "a", "player-choice");
      if (options.onSelect) {
        link.type = "button";
        link.addEventListener("click", () => {
          player = record; options.onSelect(record);
          summary.textContent = `${options.label || "Выбрать игрока"} · ${player.name}`;
          picker.open = false; renderChoices(); summary.focus?.();
        });
      } else link.href = options.playerURL ? options.playerURL(record.id) : `/?view=${view}&account_id=${encodeURIComponent(record.id)}${view === "allies" ? `&min_games=${minimumGames()}` : ""}`;
      if (record.id === player.id) link.setAttribute("aria-current", "true");
      link.append(playerAvatar(record));
      const identity = element("span", "stats-player-text"); identity.append(element("span", "", record.name), element("span", "muted small", `ID ${record.id}`));
      const stats = element("span", "player-choice-stats"); stats.append(element("span", "", `${number(record.count)} игр`), element("span", "muted small", `${percentage(record.wins, record.decided)} побед`));
      link.append(identity, stats); row.append(link); list.append(row);
    }
    found.textContent = `Найдено: ${choices.length}. Показано: ${Math.min(visible, choices.length)}.`;
    if (!choices.length) list.append(element("li", "stats-explanation muted", "Игроки не найдены. Измените запрос."));
    more.hidden = choices.length <= visible;
    void loadStatsAvatars(root, controller.signal);
  }
  search.value = "";
  search.addEventListener("input", () => { visible = 20; renderChoices(); });
  sort.addEventListener("change", () => { visible = 20; renderChoices(); });
  more.addEventListener("click", () => { visible += 20; renderChoices(); });
  picker.append(found, list, more); root.append(picker); renderChoices();
  if (options.onSelect) return player;
  if (params.has("account_id") && !data.players.has(params.get("account_id"))) {
    root.append(element("p", "notice", "Указанный игрок не найден в сохранённых матчах. Выберите игрока из списка."));
    return null;
  }
  if (view === "allies") {
    const form = element("form", "stats-controls ally-controls"); form.action = "/"; form.method = "get";
    for (const [name, value] of [["view", view], ["account_id", player.id]]) {
      const hidden = element("input"); hidden.type = "hidden"; hidden.name = name; hidden.value = value; form.append(hidden);
    }
    const minimumLabel = element("label", "stats-control-label", "Минимум совместных игр"); minimumLabel.htmlFor = "min-games";
    const minimum = element("select", "stats-select"); minimum.id = "min-games"; minimum.name = "min_games";
    for (const value of [1, 3, 5, 10]) {
      const option = element("option", "", String(value)); option.value = String(value);
      option.selected = value === minimumGames(); minimum.append(option);
    }
    minimumLabel.append(minimum); form.append(minimumLabel);
    const button = element("button", "button", "Применить"); button.type = "submit"; form.append(button); root.append(form);
  }
  const contextLink = element("a", "stats-player-link", view === "allies" ? "← Статистика игрока" : "Лучшие союзники →");
  contextLink.href = `/?view=${view === "allies" ? "player" : "allies"}&account_id=${encodeURIComponent(player.id)}`;
  const identity = element("div", "stats-player-heading");
  const name = element("h2", "", player.name);
  const steam = element("a", "player-account", `Steam · ID ${player.id} ↗`);
  steam.href = steamProfileURL(player.id); steam.target = "_blank"; steam.rel = "noopener noreferrer";
  steam.setAttribute("aria-label", `Steam-профиль ${player.name} (в новой вкладке)`);
  identity.append(playerAvatar(player), name, steam, contextLink); root.append(identity);
  return player;
}

function minimumGames() {
  const value = Number(params.get("min_games"));
  return [1, 3, 5, 10].includes(value) ? value : 1;
}

function renderPlayerStats(player, root) {
  renderPlayerSummary(player, root);
  const matchesPanel = element("section", "panel hero-matches");
  matchesPanel.id = "hero-matches"; matchesPanel.hidden = true;
  const heroButtons = [];
  function heroMatchesLink(hero) {
    const button = element("button", "hero-matches-button"); button.type = "button";
    button.append(heroBadge(hero));
    button.setAttribute("aria-label", `Матчи ${player.name} на герое ${hero.name}`);
    button.setAttribute("aria-controls", matchesPanel.id); button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      for (const other of heroButtons) other.setAttribute("aria-expanded", String(other === button));
      renderHeroMatches(hero, player, matchesPanel, () => {
        matchesPanel.hidden = true; button.setAttribute("aria-expanded", "false"); button.focus();
      });
    });
    heroButtons.push(button);
    return button;
  }
  const grid = element("div", "stats-grid");
  grid.append(statsTable("Пики и популярные герои", ["Герой", "Игр", "Побед", "Винрейт"], ranked(player.heroes).map(hero => [sortedValue(hero.name, heroMatchesLink(hero)), hero.count, hero.wins, rateCell(hero.wins, hero.decided)]), "Нажмите на героя, чтобы увидеть матчи игрока на нём. Неизвестный результат исключён из винрейта.", [{ column: 1, descending: true }]));
  const items = ranked(player.items).map(item => {
    const label = element("span", "stats-item");
    if (item.slug) {
      const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${item.slug}.png`, "stats-item-icon", "", 36);
      if (icon) { icon.height = 27; label.append(icon); }
    }
    label.append(element("span", "", item.name));
    return [sortedValue(item.name, label), item.count, item.wins, rateCell(item.wins, item.decided)];
  });
  grid.append(statsTable("Популярные предметы", ["Предмет", "Игр с предметом", "Побед", "Винрейт"], items, "Итоговый инвентарь, а не история покупок. Один предмет учитывается один раз за матч. Винрейт: победы в играх с этим предметом / игры с этим предметом и известным результатом. Без TP, вардов и смоков.", [{ column: 1, descending: true }])); root.append(matchesPanel, grid);
}

function renderPlayerSummary(player, root) {
  const summary = element("div", "stats-summary player-summary");
  const unknown = player.count - player.decided;
  const note = `Победы / поражения: ${number(player.wins)} / ${number(player.decided - player.wins)}${unknown ? ` · Без результата: ${number(unknown)}` : ""}`;
  summary.append(statisticCard("Матчей", number(player.count), note), statisticCard("Винрейт", percentage(player.wins, player.decided)));
  root.append(summary);
}

function renderHeroMatches(hero, player, panel, close) {
  const limit = 5;
  let page = 0;
  const heading = element("h2", "", `${hero.name} · Матчи игрока ${player.name}`);
  heading.id = "hero-matches-title"; heading.tabIndex = -1;
  panel.setAttribute("aria-labelledby", heading.id);
  const header = element("div", "panel-heading");
  const dismiss = element("button", "button button-quiet", "Закрыть"); dismiss.type = "button";
  dismiss.addEventListener("click", close); header.append(heading, dismiss);
  const list = element("ul", "match-list"); list.setAttribute("aria-label", `Матчи на герое ${hero.name}`);
  const footer = element("nav", "panel-footer pagination"); footer.setAttribute("aria-label", "Страницы матчей героя");
  const back = element("button", "button button-quiet", "← Назад"); back.type = "button";
  const next = element("button", "button button-quiet", "Далее →"); next.type = "button";
  const count = element("span", "page-number"); count.setAttribute("role", "status");
  function showPage() {
    list.replaceChildren(...hero.matches.slice(page * limit, (page + 1) * limit).map(renderMatch));
    back.disabled = page === 0; next.disabled = (page + 1) * limit >= hero.matches.length;
    count.textContent = `Страница ${page + 1} из ${Math.ceil(hero.matches.length / limit)} · Матчей: ${number(hero.matches.length)}`;
    heading.focus();
  }
  back.addEventListener("click", () => { if (page > 0) { page--; showPage(); } });
  next.addEventListener("click", () => { if ((page + 1) * limit < hero.matches.length) { page++; showPage(); } });
  footer.append(back, count, next); panel.replaceChildren(header, list, footer); panel.hidden = false;
  showPage();
}

function renderAllyStats(player, root) {
  renderPlayerSummary(player, root);
  const allies = [...player.allies.values()].filter(ally => ally.count >= minimumGames()).sort((a, b) =>
    (b.decided ? b.wins / b.decided : -1) - (a.decided ? a.wins / a.decided : -1) || b.decided - a.decided || b.count - a.count || a.name.localeCompare(b.name, "ru"));
  root.append(statsTable("Винрейт с союзниками", ["Союзник", "Совместных игр", "Побед", "Поражений", "Винрейт"], allies.map(ally => [sortedValue(ally.name, playerLink(ally)), ally.count, ally.wins, ally.decided - ally.wins, rateCell(ally.wins, ally.decided)]), "Игроки одной команды в сохранённых матчах, не обязательно участники одной группы. Неизвестный результат исключён из винрейта. При одинаковом винрейте выше пары с большим числом игр с известным результатом. Маленькая выборка менее показательна.", [{ column: 4, descending: true }]));
}

async function loadStats() {
  controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  for (const [id, url] of avatarCache) if (!url) avatarCache.delete(id);
  const status = document.querySelector("#stats-status"), root = document.querySelector("#stats-content");
  root.hidden = true; root.replaceChildren(); showLoading(status, "Загружаем историю для статистики…");
  try {
    const matches = await fetchStatisticsMatches(signal, count => showLoading(status, `Загружено матчей: ${count}…`));
    if (signal.aborted) return;
    if (!matches.length && view !== "insights") { showStatus(status, "Матчей пока нет", "Статистика появится после импорта матчей."); return; }
    const data = buildStatistics(matches);
    const coverage = element("div", "stats-coverage");
    coverage.append(element("p", "muted small", `Выборка: ${number(data.matches)} сохранённых матчей. После импорта новых игр нажмите «Обновить». Анонимных записей игроков: ${number(data.anonymous)}; они учитываются в общей статистике героев, но не в личной статистике.`));
    const refresh = element("button", "button button-quiet", "Обновить"); refresh.type = "button"; refresh.addEventListener("click", loadStats); coverage.append(refresh); root.append(coverage);
    if (view === "stats") renderGeneralStats(data, root);
    else if (view === "insights") renderInsights(matches, data, root, { statsTable, sortedValue, rateCell, playerLink, renderMatch,
      choosePlayer: host => renderPlayerChoice(data, host, {
        playerURL: id => `/?view=insights&section=rivals&account_id=${encodeURIComponent(id)}&min_games=${minimumGames()}`,
      }),
      chooseComparisonPlayer: (host, options) => renderPlayerChoice(data, host, options),
    });
    else { const player = renderPlayerChoice(data, root); if (player) { if (view === "player") renderPlayerStats(player, root); else renderAllyStats(player, root); } }
    status.hidden = true; root.hidden = false;
    animateSurface(root);
    void loadStatsAvatars(root, signal);
  } catch (error) {
    if (!signal.aborted) showStatus(status, "Не удалось рассчитать статистику", error.message, loadStats);
  }
}

function start() {
  if (view === "history") load();
  else if (view === "balancer") {
    const root = document.querySelector("#stats-content");
    const status = document.querySelector("#stats-status");
    showLoading(status, "Открываем балансировщик…");
    import("./balancer-view.js").then(({ renderBalancer }) => {
      renderBalancer(root, { getDatabaseMatches: fetchStatisticsMatches, loadDatabaseAvatars: loadStatsAvatars }); root.hidden = false; status.hidden = true;
    }).catch(() => showStatus(status, "Не удалось открыть балансировщик", "Проверьте подключение и повторите попытку.", start));
  }
  else loadStats();
}

document.querySelector(`#nav-${view}`).setAttribute("aria-current", "page");
if (view !== "history") {
  document.querySelector("#history-panel").hidden = true;
  document.querySelector("#stats-panel").hidden = false;
  const title = { stats: "Общая статистика", player: "Статистика игрока", allies: "Лучшие союзники", insights: "Аналитика матчей", balancer: "Балансировщик команд" }[view];
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#page-subtitle").textContent = view === "balancer" ? "Две пятёрки по вашим позициям и доступным рангам игроков." : "По сохранённым матчам вашей базы на момент загрузки.";
  if (view === "balancer") {
    document.querySelector(".source-label").textContent = "5 × 5 · Позиции 1–5";
    document.querySelector(".page-note").textContent = "Список друзей хранится в этом браузере. MMR рассчитывается приблизительно по рангу и не сохраняется.";
  }
  document.title = `${title} · Dota Stats`;
}
start();
