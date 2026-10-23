import { element, image, heroBadge, requestJSON, showStatus, showLoading, animateSurface } from "./common.js";
import { itemInfo, itemImageURLs, abilityInfo } from "./items.js";

function itemImage(id, className, size) {
  const [url, ...fallbacks] = itemImageURLs(id);
  return image(url, className, "", size, fallbacks);
}

function visiblePurchase(purchase) {
  const slug = itemInfo(purchase.item_id)?.[1] || "";
  return ![42, 43, 46, 218].includes(purchase.item_id) &&
    !["ward_observer", "ward_sentry", "ward_dispenser", "tpscroll"].includes(slug) && !slug.startsWith("recipe_");
}

export function purchaseTime(seconds) {
  return `${seconds < 0 ? "−" : ""}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.abs(seconds) % 60).padStart(2, "0")}`;
}

export function purchaseBucket(seconds, intervalSeconds = 300) {
  return Math.max(0, Math.ceil(seconds / intervalSeconds));
}

export function purchaseScale(seconds) {
  const minutes = Number.isFinite(seconds) ? Math.max(0, seconds) / 60 : 0;
  const intervalMinutes = Math.max(5, Math.ceil(minutes / 50) * 5);
  return { intervalMinutes, columns: Math.max(1, Math.ceil(minutes / intervalMinutes)) };
}

export function renderMatchTabs(panels, initial = "overview", onSelect = () => {}) {
  const nav = element("nav", "match-tabs");
  nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Статистика матча");
  const entries = [["overview", "Обзор"], ["purchases", "Покупки предметов"], ["skills", "Прокачка"]];
  const buttons = entries.map(([key, name]) => {
    const button = element("button", "match-tab", name); button.type = "button"; button.id = `tab-${key}`;
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `section-${key}`);
    panels[key].id = `section-${key}`; panels[key].setAttribute("role", "tabpanel");
    panels[key].setAttribute("aria-labelledby", button.id); panels[key].tabIndex = 0;
    button.addEventListener("click", () => select(key));
    return button;
  });
  function select(key, focus = false) {
    const changed = panels[key].hidden;
    entries.forEach(([name], index) => {
      panels[name].hidden = name !== key;
      buttons[index].setAttribute("aria-selected", String(name === key));
      buttons[index].tabIndex = name === key ? 0 : -1;
      if (name === key && focus) buttons[index].focus();
    });
    onSelect(key);
    if (changed) animateSurface(panels[key]);
  }
  buttons.forEach((button, index) => button.addEventListener("keydown", event => {
    const target = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
    if (target !== null) { event.preventDefault(); select(entries[target][0], true); }
  }));
  nav.append(...buttons); select(panels[initial] ? initial : "overview"); return nav;
}

function purchaseIcon(purchase) {
  const info = itemInfo(purchase.item_id), name = info?.[0] || `Предмет #${purchase.item_id}`;
  const entry = element("button", `purchase-entry${purchase.time < 0 ? " purchase-pregame" : ""}`);
  entry.type = "button"; entry.title = `${name} · ${purchaseTime(purchase.time)}`;
  entry.setAttribute("aria-label", entry.title);
  const icon = element("span", "purchase-icon", info ? Array.from(name)[0] : "?"); icon.setAttribute("aria-hidden", "true");
  if (info) {
    const img = itemImage(purchase.item_id, "purchase-image", 40);
    if (img) icon.append(img);
  }
  entry.append(icon, element("span", "purchase-time mono", purchaseTime(purchase.time)), element("span", "purchase-tooltip", name));
  return entry;
}

export function renderPurchases(match, matchID, signal) {
  const panel = element("section", "panel purchases-panel");
  panel.setAttribute("aria-labelledby", "purchases-title");
  const heading = element("div", "panel-heading purchases-heading");
  const title = element("h2", "", "Покупки"); title.id = "purchases-title";
  const scaleLabel = element("span", "muted small", "Весь матч");
  heading.append(title, scaleLabel);
  const players = match.players.filter(player => Number.isInteger(player.player_slot));
  const status = element("div", "status purchase-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const history = element("div", "purchase-history"); history.hidden = true;
  const note = element("p", "purchase-note muted small");
  panel.append(heading, status, history, note);
  let records = new Map();

  function showTable() {
    history.replaceChildren(); history.hidden = true;
    if (!players.length) { showStatus(status, "Нет данных об игроках"); return; }
    status.hidden = true;
    let lastTime = Number.isFinite(match.duration) ? Math.max(0, match.duration) : 0;
    for (const purchases of records.values()) for (const purchase of purchases || []) if (visiblePurchase(purchase)) lastTime = Math.max(lastTime, purchase.time);
    const { intervalMinutes, columns: lastColumn } = purchaseScale(lastTime);
    const intervalSeconds = intervalMinutes * 60;
    const columnCount = lastColumn + 1;
    scaleLabel.textContent = `Весь матч · интервалы по ${intervalMinutes} мин`;
    note.textContent = `Варды, свитки телепортации и рецепты скрыты. 0′ — стартовые покупки; остальные столбцы — покупки за предыдущие ${intervalMinutes} мин. На иконке указано точное время. На узком экране таблицу можно прокрутить вправо.`;
    const table = element("table", "purchase-table");
    table.setAttribute("style", `min-width: ${200 + columnCount * 94}px`);
    table.append(element("caption", "sr-only", "Покупки всех игроков по игровому времени"));
    const head = element("thead"), header = element("tr"), label = element("th", "purchase-player-label", "Игрок"); label.scope = "col"; header.append(label);
    for (let index = 0; index <= lastColumn; index++) {
      const th = element("th", "purchase-column", `${index * intervalMinutes}′`); th.scope = "col";
      th.title = index === 0 ? "До начала игры и 0:00" : `${(index - 1) * intervalMinutes}:00 – ${index * intervalMinutes}:00`;
      header.append(th);
    }
    head.append(header); table.append(head);
    for (const [side, name] of [["radiant", "Radiant"], ["dire", "Dire"], [null, "Другие игроки"]]) {
      const team = players.filter(player => side ? player.side === side : !["radiant", "dire"].includes(player.side));
      if (!team.length) continue;
      const body = element("tbody", `purchase-team ${side || "unknown"}`);
      const divider = element("tr", "purchase-team-heading"), teamName = element("th", "", name); teamName.colSpan = columnCount + 1; teamName.scope = "rowgroup"; divider.append(teamName); body.append(divider);
      for (const player of team) {
        const row = element("tr", "purchase-player-row"), identity = element("th", "purchase-player-label"); identity.scope = "row";
        identity.append(heroBadge(player), element("span", "purchase-nickname", player.nickname || "Анонимный игрок")); row.append(identity);
        const original = records.get(player.player_slot);
        const purchases = Array.isArray(original) ? original.filter(visiblePurchase) : original;
        if (!Array.isArray(purchases) || !purchases.length) {
          const message = !Array.isArray(purchases) ? "Нет данных о покупках этого игрока" : original.length ? "Нет покупок для отображения" : "Нет записей о покупках";
          const empty = element("td", "purchase-empty muted", message); empty.colSpan = columnCount; row.append(empty);
        } else {
          const buckets = Array.from({ length: lastColumn + 1 }, () => []);
          for (const purchase of [...purchases].sort((a, b) => a.time - b.time)) buckets[purchaseBucket(purchase.time, intervalSeconds)].push(purchase);
          for (const bucket of buckets) {
            const cell = element("td"), list = element("div", "purchase-cell-items");
            for (const purchase of bucket) list.append(purchaseIcon(purchase));
            cell.append(list); row.append(cell);
          }
        }
        body.append(row);
      }
      table.append(body);
    }
    const scroll = element("div", "purchase-scroll"); scroll.tabIndex = 0;
    scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "История покупок, прокручиваемый список");
    scroll.append(table); history.append(scroll); history.hidden = false;
  }

  async function loadPurchases() {
    if (signal.aborted) return;
    history.hidden = true;
    showLoading(status, "Загружаем покупки…"); panel.setAttribute("aria-busy", "true");
    try {
      const response = await requestJSON(`/api/matches/${matchID}/purchases`, signal);
      if (signal.aborted) return;
      if (typeof response?.available !== "boolean" || !Array.isArray(response.players)) throw new Error("Сервер вернул некорректную историю покупок.");
      if (!response.available) {
        showStatus(status, "История покупок недоступна", "Для этого матча расширенная статистика пока не сохранена."); return;
      }
      records = new Map();
      for (const entry of response.players) {
        if (!Number.isInteger(entry?.player_slot) || records.has(entry.player_slot) ||
          (entry.purchases != null && (!Array.isArray(entry.purchases) || entry.purchases.some(purchase => !Number.isInteger(purchase?.item_id) || purchase.item_id <= 0 || !Number.isSafeInteger(purchase.time))))) {
          throw new Error("Сервер вернул некорректную историю покупок.");
        }
        records.set(entry.player_slot, entry.purchases);
      }
      showTable();
    } catch (error) {
      if (!signal.aborted) showStatus(status, "Не удалось загрузить покупки", error.message, loadPurchases);
    } finally {
      if (!signal.aborted) panel.setAttribute("aria-busy", "false");
    }
  }
  loadPurchases();
  return panel;
}

export function renderSkillProgression(match) {
  const panel = element("section", "panel skill-progression");
  const heading = element("div", "panel-heading"); heading.append(element("h2", "", "Прокачка способностей"), element("span", "muted small", "Способности и таланты"));
  panel.append(heading, element("p", "purchase-note muted small", "Номера — события изучения, не уровни героя. Талант и способность могут изучаться на одном уровне; точные уровни в этих данных отсутствуют."));
  const scroll = element("div", "skill-progression-scroll"); scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Прокачка игроков по командам");
  const table = element("table", "skill-progression-table");
  table.append(element("caption", "sr-only", "Способности и таланты игроков в исходном порядке изучения"));
  const head = element("thead"), header = element("tr");
  for (const title of ["Игрок", "Способности", "Таланты"]) { const th = element("th", "", title); th.scope = "col"; header.append(th); }
  head.append(header); table.append(head);
  for (const [side, name] of [["radiant", "Radiant"], ["dire", "Dire"], [null, "Другие игроки"]]) {
    const team = match.players.filter(player => side ? player.side === side : !["radiant", "dire"].includes(player.side));
    if (!team.length) continue;
    const body = element("tbody", `skill-team ${side || "unknown"}`);
    const divider = element("tr", "purchase-team-heading"), title = element("th", "", name); title.colSpan = 3; title.scope = "rowgroup"; divider.append(title); body.append(divider);
    for (const player of team) {
      const row = element("tr"), label = element("th", "purchase-player-label"); label.scope = "row";
      label.append(heroBadge(player), element("span", "purchase-nickname", player.nickname || "Анонимный игрок")); row.append(label);
      const abilities = element("div", "skill-lane skill-abilities"), talents = element("div", "skill-lane skill-talents");
      const upgrades = Array.isArray(player.ability_upgrades) ? player.ability_upgrades : [];
      upgrades.forEach((id, index) => {
        const info = abilityInfo(id), talent = Boolean(info?.[1]?.startsWith("special_bonus_"));
        const name = info?.[0]?.replace(/\{[^}]+\}/g, "…") || `Способность #${id ?? "?"}`;
        const entry = element("button", `skill-event${talent ? " skill-talent-event" : ""}`); entry.type = "button";
        entry.title = `Событие ${index + 1}: ${talent ? "Талант · " : ""}${name}`; entry.setAttribute("aria-label", entry.title);
        const frame = element("span", "skill-event-icon", talent ? "Т" : Array.from(name)[0]); frame.setAttribute("aria-hidden", "true");
        const path = talent ? "icons/talents.svg" : info ? `abilities/${info[1]}.png` : null;
        if (path) { const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/${path}`, "skill-event-image", "", 36); if (icon) frame.append(icon); }
        entry.append(frame, element("span", "skill-event-index", index + 1), element("span", "purchase-tooltip", name));
        (talent ? talents : abilities).append(entry);
      });
      for (const lane of [abilities, talents]) {
        const cell = element("td");
        if (!lane.children.length) lane.append(element("span", "muted small", !Array.isArray(player.ability_upgrades) ? "История недоступна" : "Нет записей"));
        cell.append(lane); row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
  }
  if (!match.players.length) panel.append(element("p", "status muted", "Нет данных об игроках"));
  else { scroll.append(table); panel.append(scroll); }
  return panel;
}

function itemSlot(id, label, level) {
  const slot = element("span", "item-slot");
  slot.setAttribute("role", "img");
  if (id === 0) {
    slot.className += " item-empty";
    slot.title = `${label}: пусто`;
  } else if (id == null) {
    slot.className += " item-unknown";
    slot.textContent = "?";
    slot.title = `${label}: нет данных`;
  } else {
    const info = itemInfo(id);
    const name = info?.[0] || `Предмет #${id}`;
    slot.title = `${label}: ${name}${level > 0 ? ` · уровень ${level}` : ""}`;
    slot.textContent = info ? Array.from(name)[0] : "?";
    if (info) {
      const icon = itemImage(id, "item-image", 32);
      if (icon) slot.append(icon);
    }
  }
  slot.setAttribute("aria-label", slot.title);
  return slot;
}

export function renderInventory(player, large = false) {
  const inventory = element("div", `inventory${large ? " inventory-large" : ""}`);
  inventory.setAttribute("role", "group");
  inventory.setAttribute("aria-label", "Предметы на конец матча");
  const equipment = element("div", "inventory-equipment");
  const main = element("div", "inventory-main");
  for (let slot = 0; slot < 6; slot++) main.append(itemSlot(player[`item_${slot}`], `Основной слот ${slot + 1}`));
  equipment.append(main);
  const backpack = element("div", "inventory-backpack");
  for (let slot = 6; slot < 9; slot++) backpack.append(itemSlot(player[`item_${slot}`], `Рюкзак, слот ${slot - 5}`));
  equipment.append(backpack);
  const extra = element("div", "inventory-extra");
  extra.append(itemSlot(player.item_9, "Нейтралка"), itemSlot(player.item_10, "Чара нейтралки", player.item_10_lvl));
  inventory.append(equipment, extra, renderAghanims(player));
  return inventory;
}

export function aghanimState(player) {
  // OpenDota dotaconstants: permanent buff 2 = Scepter, 12 = Shard.
  // Presence of a permanent buff is authoritative even when stack_count is zero.
  const inventory = Array.from({ length: 11 }, (_, index) => player[`item_${index}`]);
  const buffs = Array.isArray(player.permanent_buffs) ? player.permanent_buffs : null;
  const complete = buffs !== null && inventory.every(value => Number.isInteger(value) && value >= 0);
  function state(buff, ids, scepter = false) {
    if (buffs?.some(entry => entry?.permanent_buff === buff)) return { state: "permanent", label: "Постоянное улучшение" };
    const index = inventory.findIndex(id => ids.includes(id));
    if (index !== -1) {
      if (scepter && inventory[index] === 108 && index < 6) return { state: "active", label: "Scepter в основном инвентаре" };
      if (scepter && inventory[index] === 108 && index >= 6 && index <= 8) return { state: "backpack", label: "Scepter в рюкзаке · неактивен" };
      return { state: "item", label: "Предмет в инвентаре · постоянное улучшение не подтверждено" };
    }
    return { state: complete ? "absent" : "unknown", label: complete ? "Не обнаружено на конец матча" : "Нет полных данных об улучшении" };
  }
  return { scepter: state(2, [108, 271, 727], true), shard: state(12, [609, 725]) };
}

function renderAghanims(player) {
  const root = element("div", "aghanim-upgrades"); root.setAttribute("aria-label", "Улучшения Аганима на конец матча");
  const states = aghanimState(player);
  for (const [key, name, slug] of [["scepter", "Aghanim’s Scepter", "ultimate_scepter"], ["shard", "Aghanim’s Shard", "aghanims_shard"]]) {
    const status = states[key], slot = element("span", `aghanim-indicator aghanim-${status.state}`);
    slot.title = `${name}: ${status.label}`; slot.setAttribute("role", "img"); slot.setAttribute("aria-label", slot.title);
    const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${slug}.png`, "aghanim-image", "", 28);
    if (icon) slot.append(icon);
    slot.append(element("span", "aghanim-state", status.state === "unknown" ? "?" : status.state === "absent" ? "—" : status.state === "permanent" || status.state === "active" ? "●" : "○"));
    root.append(slot);
  }
  return root;
}

export function renderTeamAbilityBuild(players, side) {
  const panel = element("details", "team-skill-build");
  panel.append(element("summary", "", `${side} · Порядок изучения способностей команды`));
  panel.append(element("p", "ability-step-note", "Столбцы — шаги изучения, не уровни героя. Точные уровни в этих данных отсутствуют."));
  const steps = Math.max(0, ...players.map(player => Array.isArray(player.ability_upgrades) ? player.ability_upgrades.length : 0));
  if (!steps) { panel.append(element("p", "muted", "Нет записей о прокачке этой команды.")); return panel; }
  const scroll = element("div", "ability-matrix-scroll"); scroll.tabIndex = 0;
  scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", `${side}: порядок изучения способностей`);
  const table = element("table", "ability-matrix team-ability-matrix");
  table.append(element("caption", "sr-only", `${side}: игроки по строкам, шаги изучения по столбцам`));
  const head = element("thead"), header = element("tr"), identity = element("th", "ability-row-label", "Игрок / шаг"); identity.scope = "col"; header.append(identity);
  for (let index = 0; index < steps; index++) { const th = element("th", "", index + 1); th.scope = "col"; header.append(th); }
  head.append(header); table.append(head);
  const body = element("tbody");
  for (const player of players) {
    const row = element("tr"), label = element("th", "ability-row-label"); label.scope = "row";
    label.append(heroBadge(player), element("span", "small", player.nickname || (player.account_id ? `ID ${player.account_id}` : "Анонимный игрок"))); row.append(label);
    const upgrades = Array.isArray(player.ability_upgrades) ? player.ability_upgrades : [];
    if (!upgrades.length) { const cell = element("td", "muted", "Нет записей о прокачке"); cell.colSpan = steps; row.append(cell); }
    else for (let index = 0; index < steps; index++) {
      const cell = element("td");
      if (index < upgrades.length) {
        const id = upgrades[index], info = abilityInfo(id), talent = Boolean(info?.[1]?.startsWith("special_bonus_"));
        const name = info?.[0]?.replace(/\{[^}]+\}/g, "…") || `Способность #${id ?? "?"}`;
        cell.title = `Шаг ${index + 1}: ${name}`;
        const frame = element("span", "ability-icon", talent ? "Т" : Array.from(name)[0]);
        const path = talent ? "icons/talents.svg" : info ? `abilities/${info[1]}.png` : null;
        if (path) { const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/${path}`, "ability-image", "", 32); if (icon) frame.append(icon); }
        frame.setAttribute("role", "img"); frame.setAttribute("aria-label", cell.title); cell.append(frame);
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body); scroll.append(table); panel.append(scroll); return panel;
}

export function renderAbilityBuild(upgrades) {
  const section = element("div", "ability-build");
  section.append(element("p", "ability-build-label", "Прокачка · порядок изучения"));
  if (!Array.isArray(upgrades)) {
    section.append(element("p", "muted small ability-unavailable", "История прокачки недоступна"));
    return section;
  }
  if (!upgrades.length) {
    section.append(element("p", "muted small ability-unavailable", "Нет записей о прокачке"));
    return section;
  }
  const scroll = element("div", "ability-matrix-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Прокачка способностей, таблица с горизонтальной прокруткой");
  const table = element("table", "ability-matrix");
  table.append(element("caption", "sr-only", "Порядок изучения способностей. Номер столбца обозначает шаг изучения, а не уровень героя."));
  const head = element("thead");
  const header = element("tr");
  const label = element("th", "ability-row-label", "Способность / шаг");
  label.scope = "col";
  header.append(label);
  upgrades.forEach((id, index) => {
    const step = element("th", "ability-step-heading", index + 1);
    step.scope = "col";
    step.setAttribute("aria-label", `Шаг ${index + 1}`);
    header.append(step);
  });
  head.append(header);
  table.append(head);
  const body = element("tbody");
  for (const id of new Set(upgrades)) {
    const info = abilityInfo(id);
    const talent = info?.[1]?.startsWith("special_bonus_") || false;
    const name = info?.[0]?.replace(/\{[^}]+\}/g, "…") || (id == null ? "Способность неизвестна" : `Способность #${id}`);
    const row = element("tr", talent ? "ability-talent" : "");
    const rowLabel = element("th", "ability-row-label");
    rowLabel.scope = "row";
    const identity = element("span", "ability-identity");
    const frame = element("span", "ability-icon", talent ? "Т" : Array.from(name)[0]);
    frame.setAttribute("aria-hidden", "true");
    const path = talent ? "icons/talents.svg" : info ? `abilities/${info[1]}.png` : null;
    if (path) {
      const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/${path}`, "ability-image", "", 40);
      if (icon) frame.append(icon);
    }
    identity.append(frame, element("span", "ability-name", `${talent ? "Талант · " : ""}${name}`));
    rowLabel.append(identity);
    row.append(rowLabel);
    upgrades.forEach((learnedId, index) => {
      const learned = Object.is(learnedId, id) || learnedId === id;
      const cell = element("td", learned ? "ability-learned" : "ability-not-learned");
      if (learned) {
        const marker = element("span", "ability-learn-marker", "●");
        marker.setAttribute("aria-hidden", "true");
        cell.append(marker, element("span", "sr-only", `Изучено: шаг ${index + 1}`));
        cell.title = `Шаг ${index + 1}: ${name}`;
      }
      row.append(cell);
    });
    body.append(row);
  }
  table.append(body);
  scroll.append(table);
  section.append(element("p", "ability-step-note", "Номера — шаги изучения, не уровни героя."), scroll);
  return section;
}
