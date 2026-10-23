import { element, number, image, steamProfileURL, animateSurface } from "./common.js";
import { renderInventory, renderAbilityBuild } from "./inventory.js";

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
  frame.setAttribute("aria-label", name);
  frame.setAttribute("role", "img");
  frame.append(element("span", "portrait-fallback", player.hero_id == null ? "?" : `#${player.hero_id}`));
  const url = typeof player.hero_icon_url === "string" ? player.hero_icon_url.replace("/heroes/icons/", "/heroes/") : null;
  const img = image(url, "hero-portrait-image", "", 64);
  if (img) { img.height = 36; frame.append(img); }
  return frame;
}

function heroLevel(player) {
  const level = element("span", "hero-level", `Ур. ${number(player.level)}`);
  level.setAttribute("aria-label", `Уровень: ${number(player.level)}`);
  return level;
}

function identity(player, avatarSlots) {
  const root = element("div", "score-player-identity");
  const url = steamProfileURL(player.account_id);
  const profileLabel = `Steam-профиль ${player.nickname || player.account_id} (в новой вкладке)`;
  const avatar = element(url ? "a" : "span", "player-avatar score-avatar", Array.from(player.nickname?.trim() || "?")[0].toUpperCase());
  if (url) {
    avatar.href = url;
    avatar.target = "_blank";
    avatar.rel = "noopener noreferrer";
    avatar.setAttribute("aria-label", profileLabel);
  } else avatar.setAttribute("aria-hidden", "true");
  const picture = image(player.avatar_url, "avatar-image", "", 24);
  if (picture) avatar.append(picture);
  const text = element("div", "score-player-text");
  const name = element("span", "score-player-name", player.nickname || "Без имени");
  name.title = player.nickname || "Без имени";
  text.append(name);
  const link = element(url ? "a" : "span", "player-account mono", player.account_id == null ? "Account ID: —" : `ID ${player.account_id}${url ? " ↗" : ""}`);
  if (url) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", profileLabel);
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
  row.append(hero, playerCell, metricCell(player.level), kda, worthCell(player.net_worth, maximum), farm, economy,
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
  row.append(label, element("td", "score-level muted", "—"), kda, worthCell(total(players, "net_worth"), maximum), farm, economy,
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
  const teamRows = [];
  const sortControls = [];
  let sortKey = null;
  let ascending = true;
  const sortStatus = element("p", "sr-only");
  sortStatus.setAttribute("role", "status");
  function sortBy(key, label) {
    ascending = sortKey === key ? !ascending : true;
    sortKey = key;
    for (const { body, rows } of teamRows) {
      const sorted = [...rows].sort((a, b) => {
        const left = a.player[key], right = b.player[key];
        if (!valid(left) || !valid(right)) return valid(left) ? -1 : valid(right) ? 1 : a.index - b.index;
        return (ascending ? left - right : right - left) || a.index - b.index;
      });
      for (const { row } of sorted) body.append(row);
    }
    for (const control of sortControls) control.header.removeAttribute("aria-sort");
    for (const control of sortControls) {
      const active = control.key === key;
      control.button.setAttribute("aria-pressed", String(active));
      control.button.setAttribute("aria-label", `${control.label}: сортировать по ${active && ascending ? "убыванию" : "возрастанию"} внутри каждой команды`);
      control.indicator.textContent = active ? ascending ? "↑" : "↓" : "↕";
      if (active) control.header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
    }
    sortStatus.textContent = `${label}: по ${ascending ? "возрастанию" : "убыванию"} внутри каждой команды. Нет данных — в конце.`;
  }
  const head = element("thead"); const header = element("tr");
  for (const [text, full, metrics] of [["Герой", "Герой"], ["Игрок", "Игрок и Steam-профиль"],
    ["Ур.", "Уровень героя", [["Ур.", "Уровень героя", "level"]]],
    ["У / С / П", "Убийства / смерти / помощи", [["У", "Убийства", "kills"], ["С", "Смерти", "deaths"], ["П", "Помощи", "assists"]]],
    ["ОЦ", "Общая ценность героя (net worth)", [["ОЦ", "Общая ценность героя", "net_worth"]]],
    ["Доб / НО", "Добивания / не отдано (denies)", [["Доб", "Добивания", "last_hits"], ["НО", "Не отдано", "denies"]]],
    ["ЗВМ / ОВМ", "Золото / опыт в минуту", [["ЗВМ", "Золото в минуту", "gold_per_min"], ["ОВМ", "Опыт в минуту", "xp_per_min"]]],
    ["УГ", "Урон героям", [["УГ", "Урон героям", "hero_damage"]]], ["УС", "Урон строениям", [["УС", "Урон строениям", "tower_damage"]]],
    ["ЛГ", "Лечение героев", [["ЛГ", "Лечение героев", "hero_healing"]]], ["Инвентарь", "Инвентарь на конец матча"]]) {
    const th = element("th", "", metrics ? undefined : text); th.scope = "col"; th.title = full; th.setAttribute("aria-label", full);
    if (metrics) {
      metrics.forEach(([shortLabel, label, key], index) => {
        if (index) th.append(element("span", "score-separator", " / "));
        const button = element("button", "score-sort", shortLabel);
        button.type = "button";
        button.title = label;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", `${label}: сортировать по возрастанию внутри каждой команды`);
        const indicator = element("span", "score-sort-indicator", "↕");
        indicator.setAttribute("aria-hidden", "true");
        button.append(indicator);
        button.addEventListener("click", () => sortBy(key, label));
        sortControls.push({ key, label, button, indicator, header: th });
        th.append(button);
      });
    }
    header.append(th);
  }
  head.append(header); table.append(head);
  const sides = groups(match.players);
  const maximum = Math.max(0, ...match.players.map(player => valid(player.net_worth) ? player.net_worth : 0));
  for (const [side, players] of sides) {
    const body = element("tbody", `score-side ${side}`);
    const divider = element("tr", "score-team-divider"); const label = element("th"); label.colSpan = 11; label.scope = "rowgroup";
    label.append(teamHeading(match, side, players)); divider.append(label); body.append(divider);
    if (!players.length) {
      const row = element("tr"); const cell = element("td", "score-empty muted", "Нет данных об игроках этой стороны."); cell.colSpan = 11; row.append(cell); body.append(row);
    }
    const rows = players.map((player, index) => ({ player, index, row: playerRow(player, maximum, avatarSlots) }));
    for (const { row } of rows) body.append(row);
    teamRows.push({ body, rows });
    table.append(body);
  }
  const foot = element("tfoot");
  const maxTotal = Math.max(0, ...sides.map(([, players]) => total(players, "net_worth") || 0));
  for (const [side, players] of sides) foot.append(totalsRow(match, side, players, maxTotal));
  table.append(foot); scroll.append(table); panel.append(scroll, sortStatus);
  panel.append(element("p", "score-legend", "ОЦ — общая ценность · УГ — урон героям · УС — урон строениям · ЛГ — лечение героев. Итоги — суммы по командам."));
  return panel;
}

export function renderResult(match) {
  const root = element("div", "result-grid");
  const sides = groups(match.players);
  for (const side of ["radiant", "dire"]) {
    const players = sides.find(([name]) => name === side)?.[1] || [];
    const team = element("div", `result-team ${side}`);
    team.append(teamHeading(match, side, players));
    const score = element("strong", "result-score", number(total(players, "kills")));
    score.title = "Сумма убийств игроков команды";
    team.append(score, element("span", "result-caption", "Убийства героев"));
    root.append(team);
  }
  return root;
}

function detailMetric(label, value) {
  const root = element("div", "detail-metric");
  root.append(element("span", "muted small", label), element("strong", "mono", number(value)));
  return root;
}

export function renderOverview(match, avatarSlots) {
  const root = element("div", "overview");
  const detail = element("section", "panel selected-player");
  detail.id = "selected-player";
  detail.setAttribute("aria-label", "Подробности выбранного героя");
  const buttons = [];
  let firstPlayer;
  function select(player, button, reveal = false) {
    for (const item of buttons) item.setAttribute("aria-pressed", String(item === button));
    const heading = element("div", "panel-heading selected-heading");
    const title = element("h2", "", player.hero_name || (player.hero_id == null ? "Герой неизвестен" : `Герой #${player.hero_id}`));
    title.tabIndex = -1;
    title.append(heroLevel(player));
    heading.append(portrait(player), title, element("span", "muted small", player.nickname || "Без имени"));
    const metrics = element("div", "detail-metrics");
    for (const [label, key] of [["Ценность героя", "net_worth"], ["Урон героям", "hero_damage"], ["Урон строениям", "tower_damage"], ["Лечение", "hero_healing"], ["Золото / мин", "gold_per_min"], ["Опыт / мин", "xp_per_min"]]) metrics.append(detailMetric(label, player[key]));
    const equipment = element("div", "detail-equipment");
    equipment.append(element("p", "ability-build-label", "Предметы на конец матча"), renderInventory(player, true));
    detail.replaceChildren(heading, metrics, equipment);
    if (reveal) {
      title.focus({ preventScroll: true });
      detail.scrollIntoView({ block: "start" });
      animateSurface(detail);
    }
  }
  for (const [side, players] of groups(match.players)) {
    const section = element("section", `overview-team ${side}`);
    section.setAttribute("aria-label", sideName(side));
    const heading = element("div", "overview-team-heading");
    heading.append(teamHeading(match, side, players), element("span", "muted small", `${players.length} игроков`));
    section.append(heading);
    const grid = element("div", "hero-cards");
    for (const player of players) {
      const card = element("article", "hero-card");
      const button = element("button", "hero-select");
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-controls", "selected-player");
      button.setAttribute("aria-label", `Показать сборку: ${player.hero_name || "герой"}, ${player.nickname || "без имени"}`);
      const heroName = element("span", "card-hero-name", player.hero_name || (player.hero_id == null ? "Герой неизвестен" : `Герой #${player.hero_id}`));
      const heroHeading = element("span", "card-hero-heading");
      heroHeading.append(heroName, heroLevel(player));
      button.append(portrait(player), heroHeading);
      buttons.push(button);
      firstPlayer ??= player;
      button.addEventListener("click", () => select(player, button, true));
      const kda = element("div", "card-kda");
      for (const [label, value] of [["У", player.kills], ["С", player.deaths], ["П", player.assists]]) {
        const metric = element("div", "card-kda-metric");
        metric.append(element("span", "muted small", label), element("strong", "mono", number(value)));
        kda.append(metric);
      }
      const worth = element("div", "card-worth");
      worth.append(element("span", "muted small", "Ценность героя"), element("strong", "mono", short(player.net_worth)));
      card.append(button, identity(player, avatarSlots), kda, worth, renderInventory(player));
      grid.append(card);
    }
    if (!players.length) grid.append(element("p", "muted small", "Нет данных об игроках этой стороны."));
    section.append(grid); root.append(section);
  }
  root.append(element("p", "selection-hint muted small", "Нажмите на героя, чтобы посмотреть его показатели и предметы. История изучения способностей — во вкладке «Прокачка»."), detail);
  if (firstPlayer) select(firstPlayer, buttons[0]);
  else detail.append(element("p", "score-empty muted", "Нет данных об игроках."));
  return root;
}

export function renderBuilds(match) {
  const panel = element("section", "panel builds-panel"); panel.setAttribute("aria-labelledby", "builds-title");
  const heading = element("div", "panel-heading"); const title = element("h2", "", "Сборки"); title.id = "builds-title";
  heading.append(title, element("span", "muted small", "Прокачка и итоговые предметы")); panel.append(heading);
  const grid = element("div", "builds-grid");
  for (const [side, players] of groups(match.players)) {
    const column = element("section", `builds-side ${side}`); column.setAttribute("aria-label", `Сборки ${sideName(side)}`);
    column.append(teamHeading(match, side, players));
    for (const player of players) {
      const card = element("article", "build-card"); const playerHeading = element("div", "build-player");
      const details = element("div", "build-player-details");
      const name = element("h3", "build-player-name", player.nickname || "Без имени"); name.title = player.nickname || "Без имени";
      details.append(name, element("span", "muted small", player.hero_name || (player.hero_id == null ? "—" : `Герой #${player.hero_id}`)), heroLevel(player));
      playerHeading.append(portrait(player), details);
      card.append(playerHeading, renderAbilityBuild(player.ability_upgrades), renderInventory(player, true)); column.append(card);
    }
    if (!players.length) column.append(element("p", "muted small", "Нет данных об игроках этой стороны."));
    grid.append(column);
  }
  panel.append(grid);
  return panel;
}
