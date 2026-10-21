import { element, image } from "./common.js";
import { abilityInfo } from "./abilities.js";

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
  const list = element("ol", "ability-sequence");
  list.setAttribute("aria-label", "Последовательность изучения способностей; номер обозначает шаг, а не уровень героя");
  upgrades.forEach((id, index) => {
    const info = abilityInfo(id);
    const talent = info?.[1].startsWith("special_bonus_") || false;
    const name = info?.[0]?.replace(/\{[^}]+\}/g, "…") || (talent ? "Талант" : `Способность #${id}`);
    const item = element("li", `ability-choice${talent ? " ability-talent" : ""}`);
    item.title = `Шаг ${index + 1}: ${name}`;
    const frame = element("span", "ability-icon", talent ? "Т" : Array.from(name)[0]);
    frame.setAttribute("role", "img");
    frame.setAttribute("aria-label", item.title);
    const path = talent ? "icons/talents.svg" : info ? `abilities/${info[1]}.png` : null;
    if (path) {
      const icon = image(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/${path}`, "ability-image", "", 28);
      if (icon) frame.append(icon);
    }
    const step = element("span", "ability-step", index + 1);
    step.setAttribute("aria-hidden", "true");
    item.append(frame, step);
    list.append(item);
  });
  section.append(list);
  return section;
}
