import { element, image, heroBadge, number, steamProfileURL, date, duration, winner, offsetFromURL, historyPageSize, historyPageSizeFromURL, saveHistoryPageSize, historyPageURL, matchID, requestJSON, showStatus, showLoading, animateSurface, noticeItems, mountSiteNotices } from "./common.js";
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
let requestedView = params.get("view");
// The Steam callback returns to /. Remember only the destination, never tokens.
try {
  const returnAt = Number(sessionStorage.getItem("dota-stats:admin-return"));
  if (!location.search && returnAt > 0 && Date.now() - returnAt >= 0 && Date.now() - returnAt < 10 * 60 * 1000) {
    requestedView = "admin";
    history.replaceState(null, "", "/?view=admin");
    sessionStorage.removeItem("dota-stats:admin-return");
  } else if (requestedView === "admin" || Date.now() - returnAt >= 10 * 60 * 1000) {
    sessionStorage.removeItem("dota-stats:admin-return");
  }
} catch { /* Browsers blocking storage can still open /?view=admin directly. */ }
const view = ["stats", "player", "allies", "insights", "balancer", "admin"].includes(requestedView) ? requestedView : "history";

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

addEventListener("pagehide", () => {
  controller?.abort();
  if (view === "admin") {
    stopAdminImports();
    adminSession = null;
    adminNotices = null;
    adminBusy = false;
    document.querySelector("#admin-content").replaceChildren();
    document.querySelector("#admin-content").hidden = true;
  }
});
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

// Administrator access lives only at /?view=admin; public navigation has no link.
let adminSession = null;
let adminBusy = false;
let adminNotices = null;
let adminImports = null;

function adminButton(label, action, className = "button") {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function adminMessage(title, description, { login = false, retry = false } = {}) {
  stopAdminImports();
  adminNotices = null;
  const root = document.querySelector("#admin-content");
  const panel = element("div", "panel admin-access");
  panel.append(element("h2", "", title), element("p", "muted admin-description", description));
  const actions = element("div", "admin-actions");
  if (login) {
    const link = element("a", "button admin-primary", "Войти через Steam");
    link.href = "/auth/steam";
    link.addEventListener("click", event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      try { sessionStorage.setItem("dota-stats:admin-return", String(Date.now())); } catch { /* Optional navigation preference. */ }
    });
    actions.append(link);
  }
  if (retry) actions.append(adminButton("Проверить снова", () => loadAdmin()));
  panel.append(actions);
  root.replaceChildren(panel);
  root.hidden = false;
}

function renderAdminSession(session, message = "") {
  const root = document.querySelector("#admin-content");
  const panel = element("section", "panel admin-access");
  panel.setAttribute("aria-labelledby", "admin-access-title");
  const heading = element("div", "admin-access-heading");
  const title = element("h2", "", "Доступ администратора");
  title.id = "admin-access-title";
  heading.append(title, element("span", "admin-connected", "Вход выполнен"));
  const details = element("dl", "admin-session-details");
  const profileRow = element("div", "");
  const profile = element("a", "admin-profile", session.admin.steam_id);
  profile.href = `https://steamcommunity.com/profiles/${session.admin.steam_id}`;
  profile.target = "_blank";
  profile.rel = "noopener noreferrer";
  profile.setAttribute("aria-label", `Steam-профиль ${session.admin.steam_id}, откроется в новой вкладке`);
  const identity = element("dd", "");
  identity.append(profile, element("span", "muted small", "Профиль Steam"));
  profileRow.append(element("dt", "", "SteamID64"), identity);
  const expiryRow = element("div", "");
  const expiry = element("dd", "");
  const time = element("time", "", date(session.expires_at));
  time.dateTime = session.expires_at;
  expiry.append(time, element("span", "muted small", "По времени вашего устройства"));
  expiryRow.append(element("dt", "", "Вход сохранён до"), expiry);
  details.append(profileRow, expiryRow);
  const actions = element("div", "admin-actions");
  actions.append(adminButton("Выйти", () => logoutAdmin(false)),
    adminButton("Выйти на всех устройствах", () => logoutAdmin(true), "button button-quiet"));
  const journal = element("a", "button button-quiet", "Консоль импорта");
  journal.href = "/admin/events";
  actions.append(journal);
  const feedback = element("p", "admin-feedback");
  feedback.id = "admin-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.textContent = message;
  feedback.hidden = !message;
  panel.append(heading, element("p", "muted admin-description", "Вы вошли через разрешённый Steam-аккаунт. Можно завершить текущий вход или отозвать все свои сессии."), details, actions, feedback);
  root.replaceChildren(createAdminImports(), createNoticesEditor(), panel);
  root.hidden = false;
}

async function requestAdmin(url, options = {}, readJSON = !options.method) {
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  const timer = setTimeout(() => requestController.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store", redirect: "error", signal: requestController.signal });
    const data = readJSON && response.ok ? await response.json() : null;
    return { status: response.status, ok: response.ok, data };
  } finally { clearTimeout(timer); }
}

async function loadAdmin(message = "") {
  if (adminBusy || adminNotices?.busy || adminImports?.writing) return;
  adminBusy = true;
  stopAdminImports();
  adminSession = null;
  const root = document.querySelector("#admin-content");
  const status = document.querySelector("#admin-status");
  root.hidden = true;
  root.replaceChildren();
  showLoading(status, "Проверяем доступ…");
  try {
    const response = await requestAdmin("/api/admin/session");
    if (response.status === 401) {
      adminMessage(message || "Вход в админ-панель", "Войдите через Steam-аккаунт, которому разрешено администрирование сайта.", { login: true });
    } else if (response.status === 403) {
      adminMessage("Нет прав администратора", "Этот Steam-аккаунт не имеет доступа к панели. Если права были изменены, проверьте доступ ещё раз.", { login: true, retry: true });
    } else {
      if (!response.ok) throw new Error("session_unavailable");
      const session = response.data;
      if (typeof session?.admin?.steam_id !== "string" || !/^[1-9]\d{0,19}$/.test(session.admin.steam_id) || typeof session.csrf_token !== "string" || !session.csrf_token ||
          typeof session.expires_at !== "string" || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) {
        throw new Error("session_invalid");
      }
      adminSession = session;
      renderAdminSession(session, message);
      await loadAdminNotices();
      if (adminSession) await loadAdminImports();
    }
    status.hidden = true;
  } catch (error) {
    if (controller?.signal.aborted && document.visibilityState === "hidden") return;
    status.hidden = true;
    adminMessage("Не удалось проверить доступ", "Сервер не ответил или вернул неполные данные. Проверьте соединение и повторите попытку.", { retry: true });
  } finally {
    adminBusy = false;
    if (adminImports) { updateImportControls(adminImports); scheduleAdminImports(adminImports); }
  }
}

async function logoutAdmin(all) {
  if (adminBusy || adminNotices?.busy || adminImports?.writing || !adminSession) return;
  adminBusy = true;
  pauseAdminImports();
  const root = document.querySelector("#admin-content");
  const buttons = root.querySelectorAll("button");
  for (const button of buttons) button.disabled = true;
  const feedback = document.querySelector("#admin-feedback");
  feedback.hidden = false;
  feedback.textContent = all ? "Завершаем вход на всех устройствах…" : "Завершаем вход…";
  try {
    const response = await requestAdmin(all ? "/api/admin/logout-all" : "/api/admin/logout", {
      method: "POST", headers: { "X-CSRF-Token": adminSession.csrf_token },
    });
    if (response.status === 204 || response.status === 401) {
      adminSession = null;
      adminMessage(response.status === 401 ? "Сессия завершена" : all ? "Вы вышли на всех устройствах" : "Вы вышли из админ-панели",
        "Чтобы вернуться к управлению сайтом, войдите через Steam.", { login: true });
      root.querySelector("a")?.focus();
    } else if (response.status === 403) {
      adminBusy = false;
      await loadAdmin("Доступ или сессия изменились. Проверьте состояние и повторите действие.");
    } else {
      throw new Error("logout_unavailable");
    }
  } catch {
    feedback.textContent = "Не удалось подтвердить выход. Повторите попытку или обновите состояние сессии.";
    const retry = adminButton("Обновить состояние", () => loadAdmin());
    feedback.replaceChildren(element("span", "", feedback.textContent), retry);
  } finally {
    adminBusy = false;
    for (const button of buttons) button.disabled = false;
    if (adminImports) { updateImportControls(adminImports); scheduleAdminImports(adminImports); }
  }
}

function createNoticesEditor() {
  const section = element("section", "panel notices-editor");
  section.setAttribute("aria-labelledby", "notices-title");
  const heading = element("div", "notices-heading");
  const title = element("h2", "", "Плашки сайта");
  title.id = "notices-title";
  const refresh = adminButton("Обновить список", () => adminNotices?.locked ? loadAdmin() : loadAdminNotices());
  heading.append(title, refresh);
  const description = element("p", "muted notices-description", "Объявления на главной и странице матча. Новые показываются первыми.");
  const columns = element("div", "notices-columns");
  const form = element("form", "notice-form");
  const formTitle = element("h3", "", "Новая плашка");
  const label = element("label", "", "Текст плашки");
  label.htmlFor = "notice-text";
  const input = element("textarea", "notice-input");
  input.id = "notice-text";
  input.name = "text";
  input.rows = 5;
  input.required = true;
  input.setAttribute("aria-describedby", "notice-help notice-counter");
  const help = element("p", "muted small", "Дату впишите в текст, если она нужна. Без HTML и форматирования.");
  help.id = "notice-help";
  const counter = element("p", "notice-counter muted small");
  counter.id = "notice-counter";
  const save = adminButton("Опубликовать", () => {} , "button admin-primary");
  save.type = "submit";
  const cancel = adminButton("Отменить изменение", () => editAdminNotice(null));
  cancel.hidden = true;
  const actions = element("div", "admin-actions");
  actions.append(save, cancel);
  const feedback = element("p", "notice-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.hidden = true;
  form.append(formTitle, label, input, help, counter, actions, feedback);
  const published = element("div", "notices-published");
  const listTitle = element("h3", "", "Опубликованные плашки");
  const listStatus = element("p", "muted notices-list-status");
  listStatus.setAttribute("role", "status");
  const list = element("ul", "notices-list");
  published.append(listTitle, listStatus, list);
  columns.append(form, published);
  section.append(heading, description, columns);
  adminNotices = { section, form, formTitle, input, counter, save, cancel, refresh, feedback, list, listStatus,
    items: [], editingId: null, busy: false, loaded: false, uncertain: false, locked: false, confirmId: null };
  const editor = adminNotices;
  input.addEventListener("input", () => updateNoticeControls(editor));
  form.addEventListener("submit", event => { event.preventDefault(); saveAdminNotice(); });
  updateNoticeControls(editor);
  return section;
}

function updateNoticeControls(editor) {
  const size = Array.from((editor.input.value || "").trim()).length;
  editor.counter.textContent = `${size} / 500 символов`;
  editor.input.setAttribute("aria-invalid", String(size > 500));
  for (const button of document.querySelector(".admin-access")?.querySelectorAll("button") || []) button.disabled = editor.busy;
  for (const button of editor.section.querySelectorAll("button")) button.disabled = editor.busy || editor.locked || editor.uncertain;
  editor.refresh.disabled = editor.busy || editor.locked && !!adminImports?.writing;
  editor.refresh.textContent = editor.locked ? "Проверить доступ" : "Обновить список";
  editor.input.disabled = editor.busy || editor.locked;
  editor.save.disabled = editor.busy || editor.locked || !editor.loaded || editor.uncertain || !editor.input.value?.trim() || size > 500;
  editor.save.textContent = editor.editingId ? "Сохранить изменения" : "Опубликовать";
  editor.formTitle.textContent = editor.editingId ? "Изменение плашки" : "Новая плашка";
  editor.cancel.hidden = !editor.editingId;
  if (adminImports) updateImportControls(adminImports);
}

function noticeFeedback(editor, text, error = false) {
  editor.feedback.textContent = text;
  editor.feedback.hidden = !text;
  editor.feedback.className = error ? "notice-feedback notice-error" : "notice-feedback";
}

function renderAdminNotices(editor) {
  editor.listStatus.textContent = editor.items.length ? `Всего: ${editor.items.length}` : "Плашек пока нет. Опубликуйте первое объявление.";
  editor.list.replaceChildren(...editor.items.map(item => {
    const row = element("li", "notice-row");
    const preview = element("p", "notice-preview", item.text);
    const actions = element("div", "admin-actions notice-row-actions");
    if (editor.confirmId === item.id) {
      const question = element("p", "notice-delete-question", "Удалить эту плашку с обеих страниц?");
      actions.append(adminButton("Удалить плашку", () => deleteAdminNotice(item.id), "button notice-danger"),
        adminButton("Оставить", () => { editor.confirmId = null; renderAdminNotices(editor); editor.list.querySelector("button")?.focus(); }));
      row.append(preview, question, actions);
    } else {
      actions.append(adminButton("Изменить", () => editAdminNotice(item)),
        adminButton("Удалить", () => { editor.confirmId = item.id; renderAdminNotices(editor); editor.list.querySelector(".notice-danger")?.focus(); }));
      row.append(preview, actions);
    }
    return row;
  }));
  updateNoticeControls(editor);
}

function editAdminNotice(item) {
  const editor = adminNotices;
  if (!editor || editor.busy || editor.locked || adminBusy) return;
  editor.editingId = item?.id || null;
  editor.input.value = item?.text || "";
  editor.confirmId = null;
  noticeFeedback(editor, "");
  renderAdminNotices(editor);
  editor.input.focus();
}

function noticeAccessFailure(response, editor) {
  if (response.status === 401) {
    adminSession = null;
    adminMessage("Сессия завершена", "Войдите через Steam, чтобы продолжить управление плашками.", { login: true });
    return true;
  }
  if (response.status === 403) {
    editor.locked = true;
    noticeFeedback(editor, "Сервер отклонил запрос. Нажмите «Проверить доступ» перед повторной отправкой.", true);
    return true;
  }
  return false;
}

async function loadAdminNotices() {
  const editor = adminNotices;
  if (!editor || editor.busy || editor.locked || !adminSession) return;
  editor.busy = true;
  editor.listStatus.textContent = "Загружаем плашки…";
  updateNoticeControls(editor);
  try {
    const response = await requestAdmin("/api/admin/notices");
    if (editor !== adminNotices || noticeAccessFailure(response, editor)) return;
    if (!response.ok) throw new Error("notices_unavailable");
    editor.items = noticeItems(response.data);
    if (editor.uncertain) noticeFeedback(editor, "Список обновлён. Проверьте, выполнено ли предыдущее действие, прежде чем отправлять его снова.");
    editor.loaded = true;
    editor.uncertain = false;
    editor.confirmId = null;
    renderAdminNotices(editor);
  } catch {
    if (editor !== adminNotices) return;
    editor.listStatus.textContent = "Не удалось обновить список. Нажмите «Обновить список», чтобы повторить.";
  } finally {
    editor.busy = false;
    if (editor === adminNotices) updateNoticeControls(editor);
  }
}

async function saveAdminNotice() {
  const editor = adminNotices;
  if (!editor || adminBusy || editor.busy || editor.locked || !editor.loaded || editor.uncertain || !adminSession) return;
  const text = (editor.input.value || "").trim();
  if (!text || Array.from(text).length > 500) {
    noticeFeedback(editor, "Введите от 1 до 500 символов без пробелов по краям.", true);
    editor.input.focus();
    return;
  }
  const editingId = editor.editingId;
  editor.busy = true;
  noticeFeedback(editor, "Сохраняем плашку…");
  updateNoticeControls(editor);
  try {
    const response = await requestAdmin(editingId ? `/api/admin/notices/${editingId}` : "/api/admin/notices", {
      method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": adminSession.csrf_token },
      body: JSON.stringify({ text }),
    }, true);
    if (editor !== adminNotices || noticeAccessFailure(response, editor)) return;
    if (response.status === 400 || response.status === 413 || response.status === 415) {
      noticeFeedback(editor, "Сервер отклонил текст плашки. Проверьте длину и повторите отправку.", true);
      return;
    }
    if (response.status === 404) {
      noticeFeedback(editor, "Плашка уже удалена. Обновите список или отмените изменение, чтобы создать новую.", true);
      return;
    }
    if (response.status !== (editingId ? 200 : 201)) throw new Error("save_unconfirmed");
    const [saved] = noticeItems({ items: [response.data] });
    if (editingId && saved.id !== editingId) throw new Error("save_invalid");
    editor.items = noticeItems({ items: [...editor.items.filter(item => item.id !== saved.id), saved] });
    editor.editingId = null;
    editor.input.value = "";
    editor.confirmId = null;
    renderAdminNotices(editor);
    noticeFeedback(editor, editingId ? "Изменения сохранены. Посетители увидят их после обновления страницы." : "Плашка опубликована. Она появится у посетителей после обновления страницы.");
    editor.busy = false;
    updateNoticeControls(editor);
    editor.input.focus();
  } catch {
    if (editor !== adminNotices) return;
    editor.uncertain = true;
    noticeFeedback(editor, "Не удалось подтвердить сохранение. Текст остался в форме. Обновите список перед повторной отправкой.", true);
  } finally {
    editor.busy = false;
    if (editor === adminNotices) updateNoticeControls(editor);
  }
}

async function deleteAdminNotice(id) {
  const editor = adminNotices;
  if (!editor || adminBusy || editor.busy || editor.locked || editor.uncertain || !adminSession || editor.confirmId !== id) return;
  editor.busy = true;
  noticeFeedback(editor, "Удаляем плашку…");
  updateNoticeControls(editor);
  try {
    const response = await requestAdmin(`/api/admin/notices/${id}`, {
      method: "DELETE", headers: { "X-CSRF-Token": adminSession.csrf_token },
    });
    if (editor !== adminNotices || noticeAccessFailure(response, editor)) return;
    if (response.status !== 204 && response.status !== 404) throw new Error("delete_unconfirmed");
    editor.items = editor.items.filter(item => item.id !== id);
    editor.confirmId = null;
    if (editor.editingId === id) { editor.editingId = null; editor.input.value = ""; }
    renderAdminNotices(editor);
    noticeFeedback(editor, response.status === 404 ? "Эта плашка уже удалена." : "Плашка удалена.");
    editor.busy = false;
    updateNoticeControls(editor);
    editor.refresh.focus();
  } catch {
    if (editor !== adminNotices) return;
    editor.uncertain = true;
    editor.confirmId = null;
    renderAdminNotices(editor);
    noticeFeedback(editor, "Не удалось подтвердить удаление. Обновите список, чтобы проверить результат.", true);
  } finally {
    editor.busy = false;
    if (editor === adminNotices) updateNoticeControls(editor);
  }
}

// Import requests own their abort controllers so queue polling cannot cancel
// a notice write, logout or the session check.
const importStatuses = { queued: "В очереди", running: "Выполняется", succeeded: "Завершено", failed: "Ошибка" };
const importStages = { steam_connect: "Подключение к Steam", awaiting_guard: "Подтвердите вход в мобильном приложении Steam", gc_connect: "Подключение к Dota GC", history: "Поиск истории матчей", details: "Загрузка подробностей", saving: "Сохранение матчей" };
const importConnections = { disconnected: "Не подключён", connecting: "Подключение к Steam", awaiting_guard: "Ожидается подтверждение в мобильном Steam", ready: "Steam/GC подключён", error: "Ошибка подключения" };
const importMatchID = value => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const importDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? date(value) : "—";

function importAccounts(payload) {
  if (!Array.isArray(payload?.accounts)) throw new Error("invalid_accounts");
  const ids = new Set();
  for (const account of payload.accounts) {
    if (!account || typeof account.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(account.id) || ids.has(account.id) ||
        typeof account.name !== "string" || !account.name.trim() || !Object.hasOwn(importConnections, account.connection_state) ||
        ![account.dota_account_id, account.last_checked_match_id, account.active_job_id].every(id => id === null || importMatchID(id))) throw new Error("invalid_account");
    ids.add(account.id);
  }
  return payload.accounts;
}

function importJob(job) {
  if (!job || !importMatchID(job.id) || typeof job.account_id !== "string" || typeof job.account_name !== "string" ||
      !Object.hasOwn(importStatuses, job.status) || !["history", "incremental"].includes(job.mode) ||
      !(job.mode === "history" ? importMatchID(job.min_match_id) && job.after_match_id === null : importMatchID(job.after_match_id) && job.min_match_id === null)) throw new Error("invalid_job");
  return job;
}

function importJobs(payload) {
  if (!Array.isArray(payload?.jobs) || !(payload.next_before === null || typeof payload.next_before === "string" && payload.next_before.length > 0)) throw new Error("invalid_jobs");
  const jobs = payload.jobs.map(importJob);
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("duplicate_jobs");
  return jobs;
}

function createAdminImports() {
  const section = element("section", "panel admin-imports");
  section.setAttribute("aria-labelledby", "import-title");
  const heading = element("div", "admin-access-heading");
  const title = element("h2", "", "Импорт матчей"); title.id = "import-title";
  const refresh = adminButton("Обновить состояние", () => adminImports?.locked ? loadAdmin() : loadAdminImports(true));
  heading.append(title, refresh);
  const status = element("p", "muted import-status", "Загружаем аккаунты и очередь…"); status.setAttribute("role", "status");
  const layout = element("div", "import-layout");
  const form = element("form", "import-form");
  const field = (labelText, control, id) => {
    const label = element("label", "", labelText); label.htmlFor = id; control.id = id;
    const wrap = element("div", "import-field"); wrap.append(label, control); return wrap;
  };
  const account = element("select"); account.name = "account_id";
  const accountInfo = element("p", "muted import-account-info"); accountInfo.id = "import-account-info";
  account.setAttribute("aria-describedby", accountInfo.id);
  const mode = element("select"); mode.name = "mode";
  const incremental = element("option", "", "Новые матчи после синхронизации"); incremental.value = "incremental";
  const history = element("option", "", "История до указанного Match ID"); history.value = "history";
  mode.append(incremental, history); mode.value = "incremental";
  const boundary = element("input"); boundary.name = "min_match_id"; boundary.type = "text"; boundary.inputMode = "numeric"; boundary.maxLength = 19; boundary.autocomplete = "off";
  boundary.setAttribute("aria-describedby", "import-boundary-help");
  const boundaryField = field("Нижняя граница Dota Match ID", boundary, "import-boundary");
  const boundaryHelp = element("p", "muted small", "Граничный матч включается. Это ID матча Dota, а не количество игр."); boundaryHelp.id = "import-boundary-help";
  boundaryField.append(boundaryHelp);
  const submit = adminButton("Запустить импорт", () => {}, "button admin-primary"); submit.type = "submit";
  const feedback = element("p", "import-feedback"); feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite"); feedback.hidden = true;
  form.append(field("Аккаунт импортера", account, "import-account"), accountInfo, field("Режим импорта", mode, "import-mode"), boundaryField, submit,
    element("p", "muted small", "Задание продолжит работу после закрытия страницы и выхода из админки."), feedback);
  const queue = element("div", "import-queue");
  const queueHeading = element("h3", "", "Очередь заданий");
  const list = element("ol", "import-job-list"); list.setAttribute("aria-label", "Задания импорта");
  const more = adminButton("Показать ещё", () => moreAdminImportJobs()); more.hidden = true;
  const detail = element("section", "import-job-detail"); detail.setAttribute("aria-label", "Подробности задания");
  detail.append(element("p", "muted", "Выберите задание, чтобы увидеть параметры и результаты."));
  queue.append(queueHeading, list, more, detail); layout.append(form, queue); section.append(heading, status, layout);
  const state = adminImports = { section, form, status, refresh, account, accountInfo, mode, incremental, boundary, boundaryField, submit, feedback, list, more, detail,
    accounts: [], jobs: [], next: null, expanded: false, selectedJob: null, selectedID: null, selection: 0, controllers: new Set(), timer: null,
    loaded: false, reading: false, writing: false, locked: false, uncertain: false };
  account.addEventListener("change", () => { updateImportControls(state); });
  mode.addEventListener("change", () => updateImportControls(state));
  boundary.addEventListener("input", () => { boundary.removeAttribute("aria-invalid"); updateImportControls(state); });
  form.addEventListener("submit", event => { event.preventDefault(); submitAdminImport(); });
  state.visibility = () => {
    clearTimeout(state.timer); state.timer = null;
    if (document.visibilityState === "visible" && state === adminImports && !state.locked) loadAdminImports();
  };
  document.addEventListener?.("visibilitychange", state.visibility);
  updateImportControls(state);
  return section;
}

function updateImportControls(state) {
  if (state !== adminImports) return;
  const account = state.accounts.find(item => item.id === state.account.value);
  const hasProgress = !!account?.last_checked_match_id;
  state.incremental.disabled = !hasProgress;
  if (!hasProgress) state.mode.value = "history";
  const isHistory = state.mode.value === "history";
  state.boundaryField.hidden = !isHistory; state.boundary.required = isHistory;
  const disabled = state.writing || state.locked || !state.loaded;
  state.account.disabled = disabled || !state.accounts.length;
  state.mode.disabled = disabled || !account;
  state.boundary.disabled = disabled || !isHistory;
  state.submit.disabled = disabled || state.reading || state.uncertain || !account || !!account.active_job_id || adminBusy;
  state.submit.textContent = state.writing ? "Ставим в очередь…" : "Запустить импорт";
  state.refresh.disabled = state.reading || state.writing || state.locked && !!adminNotices?.busy;
  state.refresh.textContent = state.locked ? "Проверить доступ" : "Обновить состояние";
  state.more.hidden = !state.next; state.more.disabled = state.reading || state.writing || state.locked;
  state.accountInfo.textContent = account ? `${importConnections[account.connection_state]} · Прогресс: ${account.last_checked_match_id || "неизвестен — укажите границу истории"} · Успешный запуск: ${importDate(account.last_success_at)}${account.active_job_id ? ` · Активное задание #${account.active_job_id}` : ""}` : "Настроенных аккаунтов нет.";
  if (adminNotices?.locked) adminNotices.refresh.disabled = adminNotices.busy || state.writing;
}

function importFeedback(state, message, error = false) {
  state.feedback.textContent = message; state.feedback.hidden = !message;
  state.feedback.className = error ? "import-feedback notice-error" : "import-feedback";
}

function pauseAdminImports() {
  const state = adminImports;
  if (!state) return;
  clearTimeout(state.timer); state.timer = null;
  for (const controller of state.controllers) controller.abort();
}

function stopAdminImports() {
  const state = adminImports;
  if (!state) return;
  pauseAdminImports();
  document.removeEventListener?.("visibilitychange", state.visibility);
  adminImports = null;
}

function importAccessFailure(response, state) {
  if (response.status === 401 || response.status === 403 && response.data?.error?.code === "admin_required") {
    adminSession = null;
    adminMessage(response.status === 401 ? "Сессия завершена" : "Нет прав администратора", "Войдите через разрешённый Steam-аккаунт, чтобы продолжить.", {login: true, retry: response.status === 403});
    return true;
  }
  if (response.status === 403) {
    state.locked = true; clearTimeout(state.timer);
    importFeedback(state, "Сервер отклонил запрос. Нажмите «Проверить доступ» перед повторной отправкой.", true);
    return true;
  }
  return false;
}

async function requestImport(state, url, options = {}) {
  const controller = new AbortController(); state.controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {...options, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal});
    let data = null;
    try { data = await response.json(); } catch { /* Missing JSON is validated by the caller. */ }
    return {status: response.status, ok: response.ok, data};
  } finally { clearTimeout(timer); state.controllers.delete(controller); }
}

function scheduleAdminImports(state) {
  clearTimeout(state.timer); state.timer = null;
  if (state !== adminImports || !state.loaded || state.locked || adminBusy || !adminSession || document.visibilityState !== "visible") return;
  state.timer = setTimeout(() => {
    if (state !== adminImports) return;
    if (Date.parse(adminSession?.expires_at) <= Date.now()) {
      adminSession = null; adminMessage("Сессия завершена", "Войдите через Steam, чтобы продолжить.", {login: true}); return;
    }
    loadAdminImports();
  }, 5000);
}

function renderImportJobs(state) {
  const focusedID = Array.from(state.list.querySelectorAll("button")).find(button => button === document.activeElement)?.id;
  state.list.replaceChildren(...state.jobs.map(job => {
    const row = element("li", "import-job-row");
    const button = adminButton(`#${job.id} · ${job.account_name}`, () => openAdminImportJob(job.id), "import-job-open");
    button.id = `import-job-${job.id}`;
    button.setAttribute("aria-pressed", String(state.selectedID === job.id));
    row.append(button, element("span", `import-job-state import-state-${job.status}`, importStatuses[job.status]),
      element("span", "muted small", `${importDate(job.created_at)} · ${job.mode === "history" ? `История от ID ${job.min_match_id}` : `После ID ${job.after_match_id}`}`));
    if (job.stage) row.append(element("p", "muted small", importStages[job.stage] || "Неизвестная стадия"));
    if (job.error?.message) row.append(element("p", "notice-error small", job.error.message));
    return row;
  }));
  if (!state.jobs.length) state.list.append(element("li", "muted import-empty", "Заданий пока нет. Выберите аккаунт и запустите импорт."));
  if (focusedID) state.list.querySelector(`#${focusedID}`)?.focus();
}

function renderImportDetail(state) {
  const job = state.selectedJob;
  if (!job) return;
  const title = element("h3", "", `Задание #${job.id}`);
  const parameters = element("p", "muted small", `${job.account_name} · ${job.mode === "history" ? `История от ID ${job.min_match_id}, включая границу` : `Новые матчи после ID ${job.after_match_id}`}`);
  const status = element("p", `import-job-state import-state-${job.status}`, `${importStatuses[job.status]}${job.stage ? ` · ${importStages[job.stage] || "Неизвестная стадия"}` : ""}`);
  const counters = element("dl", "import-counters");
  for (const [key, label] of [["discovered", "Найдено"], ["saved", "Сохранено"], ["existing", "Уже в базе"], ["filtered", "Отфильтровано"], ["failed", "С ошибками"]]) {
    const pair = element("div"); const value = job.counters?.[key];
    pair.append(element("dt", "muted", label), element("dd", "", Number.isSafeInteger(value) && value >= 0 ? number(value) : "—")); counters.append(pair);
  }
  state.detail.replaceChildren(title, parameters, status, counters,
    element("p", "muted small", `Создано: ${importDate(job.created_at)} · Начало: ${importDate(job.started_at)} · Завершено: ${importDate(job.finished_at)}`));
  if (job.error?.message) state.detail.append(element("p", "notice-error", job.error.message));
}

async function loadAdminImports(manual = false) {
  const state = adminImports;
  if (!state || state.reading || state.writing || state.locked || !adminSession) return;
  state.reading = true; clearTimeout(state.timer); state.timer = null; updateImportControls(state);
  try {
    const [accounts, jobs] = await Promise.all([
      requestImport(state, "/api/admin/import-accounts"), requestImport(state, "/api/admin/import-jobs?limit=20"),
    ]);
    if (state !== adminImports) return;
    if (importAccessFailure(accounts, state) || importAccessFailure(jobs, state)) return;
    if (!accounts.ok || !jobs.ok) throw new Error("unavailable");
    const nextAccounts = importAccounts(accounts.data), nextJobs = importJobs(jobs.data);
    const firstAccounts = !state.accounts.length;
    state.accounts = nextAccounts;
    const previous = state.account.value;
    state.account.replaceChildren(...state.accounts.map(item => { const option = element("option", "", item.name); option.value = item.id; return option; }));
    state.account.value = state.accounts.some(item => item.id === previous) ? previous : state.accounts[0]?.id || "";
    if (firstAccounts && state.accounts.find(item => item.id === state.account.value)?.last_checked_match_id) state.mode.value = "incremental";
    state.jobs = state.expanded ? [...nextJobs, ...state.jobs.filter(job => !nextJobs.some(next => next.id === job.id))] : nextJobs;
    // Terminal jobs are immutable. Older active jobs may finish while they
    // are outside the newest page and still need a current server snapshot.
    const olderActive = state.jobs.filter(job => !nextJobs.some(next => next.id === job.id) && job.id !== state.selectedID && ["queued", "running"].includes(job.status));
    const olderResponses = await Promise.all(olderActive.map(job => requestImport(state, `/api/admin/import-jobs/${encodeURIComponent(job.id)}`)));
    if (state !== adminImports) return;
    for (let index = 0; index < olderResponses.length; index++) {
      const response = olderResponses[index];
      if (importAccessFailure(response, state)) return;
      if (!response.ok) throw new Error("unavailable");
      const current = importJob(response.data?.job);
      if (current.id !== olderActive[index].id) throw new Error("wrong_job");
      state.jobs = state.jobs.map(job => job.id === current.id ? current : job);
    }
    if (!state.expanded) state.next = jobs.data.next_before;
    state.loaded = true;
    state.status.textContent = "Состояние обновляется каждые 5 секунд, пока эта вкладка открыта.";
    if (manual && state.uncertain) {
      state.uncertain = false;
      importFeedback(state, "Состояние обновлено. Проверьте очередь и активное задание аккаунта перед новым запуском.");
    }
    renderImportJobs(state);
    if (state.selectedID) await openAdminImportJob(state.selectedID, false);
  } catch {
    if (state !== adminImports) return;
    state.loaded = false;
    state.status.textContent = "Импорт недоступен: сервер не ответил или вернул неполные данные. Нажмите «Обновить состояние». Показанные ранее данные могли устареть.";
  } finally {
    state.reading = false;
    if (state === adminImports) { updateImportControls(state); scheduleAdminImports(state); }
  }
}

async function openAdminImportJob(id, focus = true) {
  const state = adminImports;
  if (!state || state.locked || !adminSession || !importMatchID(id)) return;
  state.selectedID = id; const selection = ++state.selection;
  state.detail.setAttribute("aria-busy", "true");
  try {
    const response = await requestImport(state, `/api/admin/import-jobs/${encodeURIComponent(id)}`);
    if (state !== adminImports || selection !== state.selection || importAccessFailure(response, state)) return;
    if (!response.ok) throw new Error("unavailable");
    const job = importJob(response.data?.job);
    if (job.id !== id) throw new Error("wrong_job");
    state.selectedJob = job;
    state.jobs = state.jobs.map(previous => previous.id === job.id ? job : previous);
    renderImportJobs(state); renderImportDetail(state);
    if (focus) { state.detail.tabIndex = -1; state.detail.focus(); }
  } catch {
    if (state !== adminImports || selection !== state.selection) return;
    state.selectedJob = null;
    state.detail.replaceChildren(element("p", "muted", "Не удалось загрузить задание. Повторите запрос."), adminButton("Повторить", () => openAdminImportJob(id)));
  } finally {
    if (state === adminImports && selection === state.selection) state.detail.removeAttribute("aria-busy");
  }
}

async function moreAdminImportJobs() {
  const state = adminImports;
  if (!state || !state.next || state.reading || state.writing || state.locked || !adminSession) return;
  state.reading = true; clearTimeout(state.timer); updateImportControls(state);
  try {
    const response = await requestImport(state, `/api/admin/import-jobs?limit=20&before=${encodeURIComponent(state.next)}`);
    if (state !== adminImports || importAccessFailure(response, state)) return;
    if (!response.ok) throw new Error("unavailable");
    const jobs = importJobs(response.data);
    state.jobs.push(...jobs.filter(job => !state.jobs.some(old => old.id === job.id)));
    state.next = response.data.next_before; state.expanded = true; renderImportJobs(state);
  } catch {
    if (state === adminImports) importFeedback(state, "Не удалось загрузить следующую страницу заданий. Повторите попытку.", true);
  } finally {
    state.reading = false;
    if (state === adminImports) { updateImportControls(state); scheduleAdminImports(state); }
  }
}

async function submitAdminImport() {
  const state = adminImports;
  const account = state?.accounts.find(item => item.id === state.account.value);
  if (!state || !adminSession || adminBusy || state.reading || state.writing || state.locked || state.uncertain || !state.loaded || !account || account.active_job_id) return;
  const mode = state.mode.value;
  if (!["incremental", "history"].includes(mode) || mode === "incremental" && !account.last_checked_match_id) return;
  const body = {account_id: account.id, mode};
  if (mode === "history") {
    const boundary = state.boundary.value.trim();
    if (!importMatchID(boundary)) {
      state.boundary.setAttribute("aria-invalid", "true"); state.boundary.focus();
      importFeedback(state, "Укажите положительный целочисленный Dota Match ID не больше 9223372036854775807.", true); return;
    }
    body.min_match_id = boundary;
  }
  state.writing = true; clearTimeout(state.timer); updateImportControls(state);
  importFeedback(state, "Ставим задание в очередь…");
  try {
    const response = await requestImport(state, "/api/admin/import-jobs", {method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": adminSession.csrf_token}, body: JSON.stringify(body)});
    if (state !== adminImports || importAccessFailure(response, state)) return;
    if (response.status === 409) {
      const code = response.data?.error?.code;
      if (code === "account_busy" && importMatchID(response.data.active_job_id)) {
        account.active_job_id = response.data.active_job_id;
        importFeedback(state, "У аккаунта уже есть активное задание. Открываем его состояние.");
        await openAdminImportJob(account.active_job_id);
      } else {
        if (code === "sync_required") { account.last_checked_match_id = null; state.mode.value = "history"; }
        importFeedback(state, code === "sync_required" ? "Нет сохранённого прогресса: укажите нижнюю границу истории." : code === "account_not_configured" ? "Проверьте учётные данные аккаунта на сервере." : "Аккаунт требует проверки подключения на сервере. Обновите состояние перед запуском.", true);
      }
      return;
    }
    if (response.status === 400) { importFeedback(state, "Сервер отклонил параметры импорта. Проверьте аккаунт, режим и Match ID.", true); return; }
    if (response.status !== 202) throw new Error("unconfirmed");
    const job = importJob(response.data?.job);
    if (job.account_id !== account.id || job.mode !== mode || mode === "history" && job.min_match_id !== body.min_match_id) throw new Error("wrong_job");
    account.active_job_id = job.id; state.jobs = [job, ...state.jobs.filter(old => old.id !== job.id)];
    state.selectedID = job.id; state.selectedJob = job; ++state.selection;
    renderImportJobs(state); renderImportDetail(state);
    importFeedback(state, `Задание #${job.id} поставлено в очередь.`);
    state.detail.tabIndex = -1; state.detail.focus();
  } catch {
    if (state !== adminImports) return;
    state.uncertain = true;
    importFeedback(state, "Не удалось подтвердить запуск. Нажмите «Обновить состояние» и проверьте очередь перед повторной отправкой.", true);
  } finally {
    state.writing = false;
    if (state === adminImports) { updateImportControls(state); scheduleAdminImports(state); }
  }
}

function start() {
  if (view === "history") load();
  else if (view === "admin") loadAdmin();
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

document.querySelector(`#nav-${view}`)?.setAttribute("aria-current", "page");
if (view !== "history") {
  document.querySelector("#history-panel").hidden = true;
  document.querySelector("#stats-panel").hidden = view === "admin";
  const title = { stats: "Общая статистика", player: "Статистика игрока", allies: "Лучшие союзники", insights: "Аналитика матчей", balancer: "Балансировщик команд", admin: "Администрирование" }[view];
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#page-subtitle").textContent = view === "balancer" ? "Две пятёрки по вашим позициям и доступным рангам игроков." : "По сохранённым матчам вашей базы на момент загрузки.";
  if (view === "balancer") {
    document.querySelector(".source-label").textContent = "5 × 5 · Позиции 1–5";
    document.querySelector(".page-note").textContent = "Список друзей хранится в этом браузере. MMR рассчитывается приблизительно по рангу и не сохраняется.";
  }
  if (view === "admin") {
    document.querySelector("#admin-panel").hidden = false;
    document.querySelector("#page-subtitle").textContent = "Импорт матчей, плашки сайта и управление доступом.";
    document.querySelector(".source-label").hidden = true;
    document.querySelector(".page-note").textContent = "Доступ к админ-панели проверяется на сервере при каждом запросе.";
  }
  document.title = `${title} · Dota Stats`;
}
start();
if (view !== "admin") mountSiteNotices(document.querySelector("#site-notices"));
