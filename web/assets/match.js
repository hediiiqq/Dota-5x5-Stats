import { date, duration, winner, offsetFromURL, matchID, image, requestJSON, showStatus, showLoading } from "./common.js";
import { renderDraft } from "./draft.js";
import { renderScoreboard, renderOverview, renderResult } from "./scoreboard.js";
import { favoriteEditor } from "./favorites.js";
import { renderPurchases, renderSkillProgression, renderMatchTabs } from "./inventory.js";

const params = new URLSearchParams(location.search);
const id = matchID(params.get("id"));
const offset = offsetFromURL();
const back = document.querySelector("#back");
back.href = offset ? `/?offset=${offset}` : "/";
const status = document.querySelector("#status");
const content = document.querySelector("#match-content");
let controller;
let avatarSlots = new Map();
let selectedView = "cards";
let selectedSection = "overview";

function setView(view) {
  selectedView = view;
  document.querySelector("#overview").hidden = view !== "cards";
  document.querySelector("#teams").hidden = view !== "table";
  document.querySelector("#view-cards").setAttribute("aria-pressed", String(view === "cards"));
  document.querySelector("#view-table").setAttribute("aria-pressed", String(view === "table"));
}

document.querySelector("#view-cards").addEventListener("click", () => setView("cards"));
document.querySelector("#view-table").addEventListener("click", () => setView("table"));

function render(match) {
  if (!match || typeof match !== "object" || !Array.isArray(match.players)) {
    throw new Error("Сервер вернул некорректные данные матча.");
  }
  avatarSlots = new Map();
  const title = match.dota_match_id == null ? "Матч" : `Матч #${match.dota_match_id}`;
  document.title = `${title} · Dota Stats`;
  document.querySelector("#match-title").textContent = title;
  document.querySelector("#match-subtitle").textContent = `Подробности игры · ${match.players.length} игроков`;
  document.querySelector("#winner").replaceChildren(winner(match.winner));
  document.querySelector("#duration").textContent = duration(match.duration);
  document.querySelector("#started-at").textContent = date(match.started_at);
  document.querySelector("#game-mode").textContent = match.game_mode_name || (Number.isInteger(match.game_mode) ? `Режим #${match.game_mode}` : "—");
  document.querySelector("#match-favorite").replaceChildren(favoriteEditor(match.id));
  document.querySelector("#draft").replaceChildren(renderDraft(match.picks_bans));
  document.querySelector("#teams").replaceChildren(renderScoreboard(match, avatarSlots));
  document.querySelector("#match-result").replaceChildren(renderResult(match));
  document.querySelector("#overview").replaceChildren(renderOverview(match, avatarSlots));
  setView(selectedView);
}

async function loadAvatars(signal) {
  const slots = avatarSlots;
  const ids = [...slots.keys()].slice(0, 10);
  if (!ids.length) return;
  try {
    const response = await requestJSON(`/api/players/avatars?account_ids=${ids.join(",")}`, signal);
    if (signal.aborted) return;
    for (const accountID of ids) {
      for (const slot of slots.get(accountID)) {
        const avatar = image(response?.avatars?.[accountID], "avatar-image", "", 40);
        if (avatar) slot.append(avatar);
      }
    }
  } catch {
    // Avatars are optional: a Steam outage must not hide the match or its stats.
  }
}

async function load() {
  if (!id) {
    showStatus(status, "Некорректный ID матча", "Откройте матч по ссылке из истории.");
    return;
  }
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  content.hidden = true;
  showLoading(status, "Загружаем матч…");
  try {
    const match = await requestJSON(`/api/matches/${id}`, signal);
    if (signal.aborted) return;
    render(match);
    status.hidden = true;
    content.hidden = false;
    document.querySelector("#purchases").replaceChildren();
    document.querySelector("#skills").replaceChildren(renderSkillProgression(match));
    let purchasesLoaded = false;
    const panels = Object.fromEntries(["overview", "purchases", "skills"].map(key => [key, document.querySelector(`#section-${key}`)]));
    document.querySelector("#match-tabs").replaceChildren(renderMatchTabs(panels, selectedSection, key => {
      selectedSection = key;
      if (key === "purchases" && !purchasesLoaded) {
        purchasesLoaded = true;
        document.querySelector("#purchases").replaceChildren(renderPurchases(match, id, signal));
      }
    }));
    loadAvatars(signal);
  } catch (error) {
    if (signal.aborted) return;
    if (error.status === 404) showStatus(status, "Матч не найден", "Возможно, он был удалён. Вернитесь к истории и выберите другую игру.");
    else showStatus(status, "Не удалось загрузить матч", error.message, load);
  }
}

addEventListener("pagehide", () => controller?.abort());
addEventListener("pageshow", event => {
  if (event.persisted && controller?.signal.aborted) load();
});
load();
