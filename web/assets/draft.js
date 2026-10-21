import { element, heroBadge } from "./common.js";

function draftGroup(title, entries, className) {
  const group = element("div", `draft-group ${className}`);
  group.append(element("h4", "draft-label", title));
  if (!entries.length) {
    group.append(element("p", "muted small draft-empty", "Нет записей"));
    return group;
  }
  const list = element("ul", "draft-list");
  for (const entry of entries) {
    const item = element("li", "draft-hero");
    item.append(heroBadge(entry));
    list.append(item);
  }
  group.append(list);
  return group;
}

export function renderDraft(entries) {
  const draft = element("div", "draft-grid");
  if (!Array.isArray(entries) || !entries.length) {
    draft.append(element("p", "muted draft-unavailable", "Данные о пиках и банах отсутствуют."));
    return draft;
  }
  const sides = { radiant: [], dire: [], unknown: [] };
  for (const value of entries) {
    const entry = value && typeof value === "object" ? value : {};
    sides[entry.team === 0 ? "radiant" : entry.team === 1 ? "dire" : "unknown"].push(entry);
  }
  for (const [side, title] of [["radiant", "Radiant"], ["dire", "Dire"], ["unknown", "Сторона неизвестна"]]) {
    const records = sides[side];
    if (side === "unknown" && !records.length) continue;
    const section = element("section", `draft-side ${side}`);
    const heading = element("h3", "team-title", title);
    heading.id = `draft-${side}`;
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading);
    section.append(draftGroup("Пики", records.filter(entry => entry.is_pick === true), "draft-picks"));
    section.append(draftGroup("Баны", records.filter(entry => entry.is_pick === false), "draft-bans"));
    const unknown = records.filter(entry => entry.is_pick !== true && entry.is_pick !== false);
    if (unknown.length) section.append(draftGroup("Тип не указан", unknown, "draft-unknown"));
    draft.append(section);
  }
  return draft;
}
