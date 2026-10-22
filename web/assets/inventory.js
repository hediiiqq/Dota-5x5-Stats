import { element, image, heroBadge } from "./common.js";
import { itemInfo, abilityInfo } from "./items.js";

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
      const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${info[1]}.png`, "item-image", "", 32);
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
