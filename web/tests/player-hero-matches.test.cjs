const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

// Exercise the real aggregation without starting the browser page or loading dependencies.
const assets = join(__dirname, "../assets");
const read = name => readFileSync(join(assets, name), "utf8").replace(/^export /gm, "");
const history = read("history.js");
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || "") + this.children.map(child => child.textContent).join(""); }
  append(...children) {
    for (const child of children) {
      if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child);
      child.parent = this; this.children.push(child);
    }
  }
  replaceChildren(...children) { this.children = []; this.text = ""; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(event, callback) { this.events[event] = callback; }
  click() { if (!this.disabled) this.events.click?.(); }
  focus() { Node.focused = this; }
}
const source = [
  read("common.js"), read("items.js"), read("favorites.js").replace(/^import .*;\r?$/gm, ""),
  "const limit = 5, offset = 0; const params = new URLSearchParams();",
  history.slice(history.indexOf("function renderTeam"), history.indexOf("async function load()")),
  history.slice(history.indexOf("const excludedItems"), history.indexOf("async function fetchStatisticsMatches")),
  history.slice(history.indexOf("function statisticCard"), history.indexOf("async function loadStats()")),
  "({ buildStatistics, renderPlayerStats, renderAllyStats });",
].join("\n");
const { buildStatistics, renderPlayerStats, renderAllyStats } = runInNewContext(source, {
  document: { createElement: tag => new Node(tag) }, URL, URLSearchParams,
});
const findAll = (root, predicate) => [root, ...root.children.flatMap(child => findAll(child, predicate))].filter(predicate);

test("hero matches belong to the selected player, including unknown outcomes", () => {
  const matches = [
    { id: "1", winner: "radiant", players: [{ account_id: "10", hero_id: 1, side: "radiant" }] },
    { id: "2", winner: "dire", players: [{ account_id: "10", hero_id: 2, side: "radiant" }, { account_id: "20", hero_id: 1, side: "dire" }] },
    { id: "3", players: [{ account_id: "10", hero_id: 1, side: "radiant" }] },
    { id: "4", players: [{ account_id: "20", hero_id: 1 }, { hero_id: 1 }] },
  ];
  const hero = buildStatistics(matches).players.get("10").heroes.get(1);
  assert.deepEqual(Array.from(hero.matches, match => match.id), ["1", "3"]);
  assert.equal(hero.matches[0], matches[0]);
  assert.equal(hero.count, 2);
  assert.equal(hero.decided, 1);
  assert.equal(hero.wins, 1);
});

test("hero buttons open only matching games, paginate, switch hero and restore focus on close", () => {
  const matches = Array.from({ length: 7 }, (_, index) => ({
    id: String(index + 1), dota_match_id: String(index + 100),
    players: [{ account_id: "10", hero_id: index < 6 ? 1 : 2, hero_name: index < 6 ? "Anti-Mage" : "Axe", side: "radiant" }],
  }));
  const root = new Node("div");
  renderPlayerStats(buildStatistics(matches).players.get("10"), root);
  const panel = findAll(root, node => node.id === "hero-matches")[0];
  const grid = findAll(root, node => node.className === "stats-grid")[0];
  assert.ok(root.children.indexOf(panel) < root.children.indexOf(grid), "Hero matches must appear above the statistics tables");
  const heroes = findAll(root, node => node.className === "hero-matches-button");
  assert.equal(panel.hidden, true);
  heroes[0].click();
  const entries = () => findAll(panel, node => node.className === "history-entry");
  assert.equal(panel.hidden, false);
  assert.equal(entries().length, 5);
  assert.equal(heroes[0].attributes["aria-expanded"], "true");
  assert.equal(Node.focused.id, "hero-matches-title");
  const forward = findAll(panel, node => node.tag === "button" && node.textContent === "Далее →")[0];
  forward.click();
  assert.equal(entries().length, 1);
  assert.match(entries()[0].textContent, /Матч #105/);
  assert.equal(forward.disabled, true);
  const link = findAll(panel, node => node.className === "button match-link")[0];
  assert.equal(link.href, "/match?id=6&offset=0");
  heroes[1].click();
  assert.equal(entries().length, 1);
  assert.match(entries()[0].textContent, /Матч #106/);
  assert.equal(heroes[0].attributes["aria-expanded"], "false");
  findAll(panel, node => node.tag === "button" && node.textContent === "Закрыть")[0].click();
  assert.equal(panel.hidden, true);
  assert.equal(heroes[1].attributes["aria-expanded"], "false");
  assert.equal(Node.focused, heroes[1]);
});

test("player and ally views share the combined summary and omit the known-result column", () => {
  const player = buildStatistics([{ id: "1", winner: "radiant", players: [
    { account_id: "10", hero_id: 1, side: "radiant" },
    { account_id: "20", hero_id: 2, side: "radiant" },
  ] }]).players.get("10");
  for (const render of [renderPlayerStats, renderAllyStats]) {
    const root = new Node("div"); render(player, root);
    const summary = findAll(root, node => node.className === "stats-summary player-summary")[0];
    assert.equal(summary.children.length, 2);
    assert.match(summary.children[0].textContent, /Победы \/ поражения: 1 \/ 0/);
    assert.equal(root.textContent.includes("С результатом"), false);
  }
});

test("duplicate player records do not repeat a match in hero history", () => {
  const match = { id: "1", players: [{ account_id: "10", hero_id: 1 }, { account_id: "10", hero_id: 1 }] };
  const hero = buildStatistics([match]).players.get("10").heroes.get(1);
  assert.equal(hero.matches.length, 1);
  assert.equal(hero.count, 1);
});
