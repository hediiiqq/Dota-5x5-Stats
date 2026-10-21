import { element, date, duration, winner, offsetFromURL, matchID, requestJSON, showStatus, showLoading } from "./common.js";

const limit = 20;
const offset = offsetFromURL();
const status = document.querySelector("#status");
const content = document.querySelector("#history-content");
const rows = document.querySelector("#matches");
const count = document.querySelector("#match-count");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
let controller;

// Keep reload, back navigation and copied page URLs on the same valid offset.
history.replaceState(null, "", offset ? `/?offset=${offset}` : "/");
document.querySelector("#page-number").textContent = `Страница ${Math.floor(offset / limit) + 1}`;
document.querySelector("#history-title").textContent = offset ? "История игр" : "Последние игры";

function pageLink(link, target, enabled) {
  link.setAttribute("aria-disabled", String(!enabled));
  if (enabled) link.href = target ? `/?offset=${target}` : "/";
  else link.removeAttribute("href");
}

function renderMatch(match) {
  const row = element("tr");
  row.append(element("td", "date-cell", date(match.started_at)));
  row.append(element("td", "mono match-id", match.dota_match_id ?? "—"));
  const result = element("td");
  result.append(winner(match.winner));
  row.append(result, element("td", "mono", duration(match.duration)));
  const action = element("td", "action-cell");
  const id = matchID(match.id);
  if (id) {
    const link = element("a", "button match-link", "Открыть матч →");
    link.href = `/match?id=${encodeURIComponent(id)}&offset=${offset}`;
    link.setAttribute("aria-label", `Открыть матч ${match.dota_match_id ?? id}`);
    action.append(link);
  } else action.textContent = "—";
  row.append(action);
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
  if (event.persisted && controller?.signal.aborted) load();
});
load();
