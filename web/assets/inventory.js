import { element, image } from "./common.js";
import { itemInfo } from "./items.js";

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
  inventory.append(equipment, extra);
  return inventory;
}
