import { steamProfileURL } from "./common.js";

export const metricLabels = {
  kills: "Убийства", deaths: "Смерти", assists: "Помощи", gold_per_min: "ЗВМ",
  xp_per_min: "ОВМ", hero_damage: "Урон героям", hero_healing: "Лечение", tower_damage: "Урон строениям",
};
const measured = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const knownSide = value => value === "radiant" || value === "dire";
export function participants(match) {
  const unique = new Map();
  for (const player of Array.isArray(match.players) ? match.players : []) {
    if (player && steamProfileURL(player.account_id) && !unique.has(player.account_id)) unique.set(player.account_id, player);
  }
  return [...unique.values()];
}
export function localDay(value) {
  if (!value) return null;
  const day = new Date(value);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
export function matchesInRange(matches, from = "", to = "") {
  return matches.filter(match => {
    if (!from && !to) return true;
    const day = localDay(match.started_at);
    return day && (!from || day >= from) && (!to || day <= to);
  });
}
function counter(player) {
  return { id: player.account_id, name: player.nickname || `ID ${player.account_id}`, games: 0, wins: 0, decided: 0 };
}
function addResult(row, match, player) {
  row.games++;
  if (knownSide(match.winner) && knownSide(player.side)) { row.decided++; row.wins += Number(match.winner === player.side); }
}
export function summarizePlayers(matches, heroId = null) {
  const result = new Map();
  for (const match of matches) for (const player of participants(match)) {
    if (heroId && player.hero_id !== Number(heroId)) continue;
    if (!result.has(player.account_id)) result.set(player.account_id, { ...counter(player), sums: {}, samples: {}, averages: {} });
    const row = result.get(player.account_id); addResult(row, match, player);
    for (const key of Object.keys(metricLabels)) if (measured(player[key])) {
      row.sums[key] = (row.sums[key] || 0) + player[key]; row.samples[key] = (row.samples[key] || 0) + 1;
    }
  }
  for (const row of result.values()) for (const key of Object.keys(metricLabels)) row.averages[key] = row.samples[key] ? row.sums[key] / row.samples[key] : null;
  return result;
}
export function rivalries(matches, accountId) {
  const rivals = new Map();
  for (const match of matches) {
    const players = participants(match), player = players.find(player => player.account_id === accountId);
    if (!player || !knownSide(player.side)) continue;
    for (const rival of players) {
      if (!knownSide(rival.side) || rival.side === player.side) continue;
      if (!rivals.has(rival.account_id)) rivals.set(rival.account_id, counter(rival));
      addResult(rivals.get(rival.account_id), match, player);
    }
  }
  return [...rivals.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "ru"));
}
export function records(matches) {
  const metrics = ["kills", "deaths", "assists", "gold_per_min", "xp_per_min", "net_worth", "hero_healing"];
  const result = Object.fromEntries([...metrics, "damage_per_min", "longest", "shortest"].map(key => [key, []]));
  function consider(key, value, match, player = null) {
    if (!measured(value)) return;
    const current = result[key][0]?.value;
    if (current === undefined || (key === "shortest" ? value < current : value > current)) result[key] = [];
    if (!result[key].length || value === result[key][0].value) result[key].push({ value, match, player });
  }
  for (const match of matches) {
    const timed = measured(match.duration) && match.duration > 0;
    if (timed) { consider("longest", match.duration, match); consider("shortest", match.duration, match); }
    for (const player of participants(match)) {
      for (const key of metrics) consider(key, player[key], match, player);
      if (timed && measured(player.hero_damage)) consider("damage_per_min", player.hero_damage / (match.duration / 60), match, player);
    }
  }
  return result;
}
export function durationStats(matches, accountId) {
  const rows = new Map();
  for (const match of matches) {
    if (!measured(match.duration) || match.duration <= 0) continue;
    const player = participants(match).find(player => player.account_id === accountId);
    if (!player || !Number.isInteger(player.hero_id) || player.hero_id <= 0) continue;
    const bucket = match.duration < 1800 ? 0 : match.duration < 2700 ? 1 : 2, key = `${player.hero_id}:${bucket}`;
    if (!rows.has(key)) rows.set(key, { ...counter(player), hero: player, bucket, label: ["До 30 минут", "30–45 минут", "45 минут и дольше"][bucket] });
    addResult(rows.get(key), match, player);
  }
  return [...rows.values()].sort((a, b) => (a.hero.hero_name || "").localeCompare(b.hero.hero_name || "", "ru") || a.hero.hero_id - b.hero.hero_id || a.bucket - b.bucket);
}
export function dailySummary(matches, day) {
  const selected = matchesInRange(matches, day, day), players = summarizePlayers(selected), heroes = new Map();
  const streaks = new Map();
  for (const match of [...selected].sort((a, b) => new Date(a.started_at) - new Date(b.started_at))) for (const player of participants(match)) {
    const row = players.get(player.account_id), last = streaks.get(player.account_id) || { won: null, length: 0 };
    if (!knownSide(match.winner) || !knownSide(player.side)) { streaks.delete(player.account_id); continue; }
    const won = player.side === match.winner, length = last.won === won ? last.length + 1 : 1;
    streaks.set(player.account_id, { won, length });
    const key = won ? "bestWins" : "bestLosses"; row[key] = Math.max(row[key] || 0, length);
  }
  for (const match of selected) for (const player of participants(match)) if (Number.isInteger(player.hero_id) && player.hero_id > 0) {
    if (!heroes.has(player.hero_id)) heroes.set(player.hero_id, { hero: player, games: 0 });
    heroes.get(player.hero_id).games++;
  }
  return { matches: selected, players: [...players.values()].map(row => ({ bestWins: 0, bestLosses: 0, ...row })),
    heroes: [...heroes.values()].sort((a, b) => b.games - a.games), records: records(selected) };
}
