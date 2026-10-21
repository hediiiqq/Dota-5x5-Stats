import { element, number, image, steamProfileURL } from "./common.js";
import { renderInventory } from "./inventory.js";

const compactFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const valid = value => typeof value === "number" && Number.isFinite(value);
const short = value => !valid(value) ? "—" : Math.abs(value) >= 1000 ? `${compactFormatter.format(value / 1000)} тыс` : number(value);
const sideName = side => side === "radiant" ? "Radiant" : side === "dire" ? "Dire" : "Сторона неизвестна";

function groups(players) {
  const grouped = { radiant: [], dire: [], unknown: [] };
  for (const player of players) {
    if (!player || typeof player !== "object") throw new Error("Некорректные данные игрока.");
    grouped[player.side === "radiant" || player.side === "dire" ? player.side : "unknown"].push(player);
  }
  return Object.entries(grouped).filter(([side, players]) => side !== "unknown" || players.length);
}

function total(players, key) {
  return players.length && players.every(player => valid(player[key])) ? players.reduce((sum, player) => sum + player[key], 0) : null;
}

function portrait(player) {
  const name = player.hero_name || (player.hero_id == null ? "Герой неизвестен" : `Герой #${player.hero_id}`);
  const frame = element("span", "hero-portrait");
  frame.title = name;
  frame.setAttribute("aria-label", `${name} · Уровень: ${number(player.level)}`);
  frame.setAttribute("role", "img");
  frame.append(element("span", "portrait-fallback", player.hero_id == null ? "?" : `#${player.hero_id}`));
  const url = typeof player.hero_icon_url === "string" ? player.hero_icon_url.replace("/heroes/icons/", "/heroes/") : null;
  const img = image(url, "hero-portrait-image", "", 64);
  if (img) { img.height = 36; frame.append(img); }
  const level = element("span", "hero-level", number(player.level));
  level.title = `Уровень: ${number(player.level)}`;
  frame.append(level);
  return frame;
}

function identity(player, avatarSlots) {
  const root = element("div", "score-player-identity");
  const avatar = element("span", "player-avatar score-avatar", Array.from(player.nickname?.trim() || "?")[0].toUpperCase());
  avatar.setAttribute("aria-hidden", "true");
  const picture = image(player.avatar_url, "avatar-image", "", 24);
  if (picture) avatar.append(picture);
  const text = element("div", "score-player-text");
  const name = element("span", "score-player-name", player.nickname || "Без имени");
  name.title = player.nickname || "Без имени";
  text.append(name);
  const url = steamProfileURL(player.account_id);
  const link = element(url ? "a" : "span", "player-account mono", player.account_id == null ? "Account ID: —" : `ID ${player.account_id}${url ? " ↗" : ""}`);
  if (url) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Steam-профиль ${player.nickname || player.account_id} (в новой вкладке)`);
    if (!picture) {
      const slots = avatarSlots.get(player.account_id) || [];
      slots.push(avatar);
      avatarSlots.set(player.account_id, slots);
    }
  }
  text.append(link);
  root.append(avatar, text);
  return root;
}

function teamHeading(match, side, players, totals = false) {
  const root = element("div", `score-team-identity ${side}`);
  const logo = image(match[`${side}_team_logo_url`], "score-team-logo", "", 22);
  if (logo) root.append(logo);
  root.append(element("span", "score-team-name", sideName(side)));
  const name = match[`${side}_team_name`];
  if (name && !totals) root.append(element("span", "muted score-team-custom", name));
  if (!totals && match.winner === side) root.append(element("span", "score-win", "Победа"));
  return root;
}

function pair(...values) {
  const root = element("span", "score-pair");
  values.forEach((value, index) => {
    if (index) root.append(element("span", "score-separator", " / "));
    root.append(element("span", "", number(value)));
  });
  return root;
}

function worthCell(value, maximum) {
  const cell = element("td", "score-worth mono");
  const root = element("span", "worth-content");
  const label = element("span", "worth-value", short(value));
  label.title = number(value);
  root.append(label);
  if (valid(value)) {
    const track = element("span", "worth-track");
    track.setAttribute("aria-hidden", "true");
    const bar = element("span", "worth-bar");
    bar.style.width = `${maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0}%`;
    track.append(bar);
    root.append(track);
  }
  cell.append(root);
  return cell;
}

function metricCell(value) {
  const cell = element("td", "score-metric mono", short(value));
  cell.title = number(value);
  return cell;
}

function playerRow(player, maximum, avatarSlots) {
  const row = element("tr", "score-player-row");
  const hero = element("td", "score-hero"); hero.append(portrait(player));
  const playerCell = element("th", "score-player"); playerCell.scope = "row"; playerCell.append(identity(player, avatarSlots));
  const kda = element("td", "score-kda mono"); kda.append(pair(player.kills, player.deaths, player.assists));
  const farm = element("td", "score-farm mono"); farm.append(pair(player.last_hits, player.denies));
  const economy = element("td", "score-economy mono"); economy.append(pair(player.gold_per_min, player.xp_per_min));
  const inventory = element("td", "score-inventory"); inventory.append(renderInventory(player));
  row.append(hero, playerCell, kda, worthCell(player.net_worth, maximum), farm, economy,
    metricCell(player.hero_damage), metricCell(player.tower_damage), metricCell(player.hero_healing), inventory);
  return row;
}

function totalsRow(match, side, players, maximum) {
  const row = element("tr", `score-total ${side}`);
  const label = element("th", "score-total-label"); label.scope = "row"; label.colSpan = 2;
  label.append(teamHeading(match, side, players, true));
  const kda = element("td", "mono"); kda.append(pair(total(players, "kills"), total(players, "deaths"), total(players, "assists")));
  const farm = element("td", "mono"); farm.append(pair(total(players, "last_hits"), total(players, "denies")));
  const economy = element("td", "mono"); economy.append(pair(total(players, "gold_per_min"), total(players, "xp_per_min")));
  row.append(label, kda, worthCell(total(players, "net_worth"), maximum), farm, economy,
    metricCell(total(players, "hero_damage")), metricCell(total(players, "tower_damage")), metricCell(total(players, "hero_healing")), element("td", "muted", "—"));
  return row;
}

export function renderScoreboard(match, avatarSlots) {
  const panel = element("section", "panel scoreboard-panel");
  panel.setAttribute("aria-labelledby", "scoreboard-title");
  const heading = element("div", "panel-heading");
  const title = element("h2", "", "Показатели игроков"); title.id = "scoreboard-title";
  heading.append(title, element("span", "muted small", "На конец матча"));
  panel.append(heading);
  const scroll = element("div", "table-scroll scoreboard-scroll");
  scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Статистика игроков, таблица с горизонтальной прокруткой");
  const table = element("table", "scoreboard");
  table.append(element("caption", "sr-only", "Показатели всех игроков и суммы по командам. ОЦ — общая ценность героя, УГ — урон героям, УС — урон строениям, ЛГ — лечение героев."));
  const head = element("thead"); const header = element("tr");
  for (const [text, full] of [["Герой", "Герой и уровень"], ["Игрок", "Игрок и Steam-профиль"], ["У / С / П", "Убийства / смерти / помощи"],
    ["ОЦ", "Общая ценность героя (net worth)"], ["Доб / НО", "Добивания / не отдано (denies)"], ["ЗВМ / ОВМ", "Золото / опыт в минуту"],
    ["УГ", "Урон героям"], ["УС", "Урон строениям"], ["ЛГ", "Лечение героев"], ["Инвентарь", "Инвентарь на конец матча"]]) {
    const th = element("th", "", text); th.scope = "col"; th.title = full; th.setAttribute("aria-label", full); header.append(th);
  }
  head.append(header); table.append(head);
  const sides = groups(match.players);
  const maximum = Math.max(0, ...match.players.map(player => valid(player.net_worth) ? player.net_worth : 0));
  for (const [side, players] of sides) {
    const body = element("tbody", `score-side ${side}`);
    const divider = element("tr", "score-team-divider"); const label = element("th"); label.colSpan = 10; label.scope = "rowgroup";
    label.append(teamHeading(match, side, players)); divider.append(label); body.append(divider);
    if (!players.length) {
      const row = element("tr"); const cell = element("td", "score-empty muted", "Нет данных об игроках этой стороны."); cell.colSpan = 10; row.append(cell); body.append(row);
    }
    for (const player of players) body.append(playerRow(player, maximum, avatarSlots));
    table.append(body);
  }
  const foot = element("tfoot");
  const maxTotal = Math.max(0, ...sides.map(([, players]) => total(players, "net_worth") || 0));
  for (const [side, players] of sides) foot.append(totalsRow(match, side, players, maxTotal));
  table.append(foot); scroll.append(table); panel.append(scroll);
  panel.append(element("p", "score-legend", "ОЦ — общая ценность · УГ — урон героям · УС — урон строениям · ЛГ — лечение героев. Итоги — суммы по командам."));
  return panel;
}

export function renderBuilds(match) {
  const panel = element("section", "panel builds-panel"); panel.setAttribute("aria-labelledby", "builds-title");
  const heading = element("div", "panel-heading"); const title = element("h2", "", "Сборки"); title.id = "builds-title";
  heading.append(title, element("span", "muted small", "Предметы на конец матча")); panel.append(heading);
  const grid = element("div", "builds-grid");
  for (const [side, players] of groups(match.players)) {
    const column = element("section", `builds-side ${side}`); column.setAttribute("aria-label", `Сборки ${sideName(side)}`);
    column.append(teamHeading(match, side, players));
    for (const player of players) {
      const card = element("article", "build-card"); const playerHeading = element("div", "build-player");
      const details = element("div", "build-player-details");
      const name = element("h3", "build-player-name", player.nickname || "Без имени"); name.title = player.nickname || "Без имени";
      details.append(name, element("span", "muted small", player.hero_name || (player.hero_id == null ? "—" : `Герой #${player.hero_id}`)));
      playerHeading.append(portrait(player), details);
      card.append(playerHeading, renderInventory(player, true)); column.append(card);
    }
    if (!players.length) column.append(element("p", "muted small", "Нет данных об игроках этой стороны."));
    grid.append(column);
  }
  panel.append(grid);
  return panel;
}
