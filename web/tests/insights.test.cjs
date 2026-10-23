const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../assets/insights.js');
const match = (id, players, extra = {}) => ({ id: String(id), winner: 'radiant', duration: 1800, started_at: '2026-10-20T18:00:00Z', players, ...extra });
const player = (id, side, extra = {}) => ({ account_id: String(id), nickname: `P${id}`, side, hero_id: 1, ...extra });

test('comparison ignores missing metrics and unknown outcomes, deduplicates accounts and filters heroes', async () => {
  const { summarizePlayers } = await load();
  const games = [match(1, [player(1, 'radiant', { kills: 10 }), player(1, 'radiant', { kills: 90 })]),
    match(2, [player(1, 'radiant', { kills: null })], { winner: null }),
    match(3, [player(1, 'dire', { kills: 2, hero_id: 2 })])];
  const all = summarizePlayers(games).get('1');
  assert.equal(all.games, 3); assert.equal(all.decided, 2); assert.equal(all.wins, 1);
  assert.equal(all.averages.kills, 6); assert.equal(all.samples.kills, 2);
  const hero = summarizePlayers(games, 1).get('1');
  assert.equal(hero.games, 2); assert.equal(hero.averages.kills, 10);
});

test('rivals count only opposite known sides and preserve unknown results', async () => {
  const { rivalries } = await load();
  const games = [match(1, [player(1, 'radiant'), player(2, 'dire'), player(2, 'dire')]),
    match(2, [player(1, 'radiant'), player(2, 'radiant')]),
    match(3, [player(1, 'radiant'), player(2, 'dire')], { winner: null }),
    match(4, [player(1, null), player(2, 'dire')])];
  const pair = rivalries(games, '1')[0];
  assert.equal(pair.id, '2'); assert.equal(pair.games, 2); assert.equal(pair.decided, 1); assert.equal(pair.wins, 1);
});

test('records preserve ties, reject missing/zero durations for per-minute damage', async () => {
  const { records } = await load();
  const result = records([match(1, [player(1, 'radiant', { kills: 5, hero_damage: 600 })]),
    match(2, [player(2, 'radiant', { kills: 5, hero_damage: 1000 })], { duration: 0 })]);
  assert.equal(result.kills.length, 2); assert.equal(result.damage_per_min.length, 1);
  assert.equal(result.damage_per_min[0].value, 20); assert.equal(result.shortest[0].match.id, '1');
});

test('new records retain ties and ignore missing or invalid values', async () => {
  const { records } = await load();
  const result = records([
    match(1, [player(1, 'radiant', { deaths: 20, gold_per_min: 800, xp_per_min: 900, net_worth: 40000 })]),
    match(2, [player(2, 'dire', { deaths: 20, gold_per_min: 850, xp_per_min: 1000, net_worth: 45000 })]),
    match(3, [player(3, 'radiant', { deaths: null, gold_per_min: -1, xp_per_min: NaN, net_worth: Infinity })]),
  ]);
  assert.equal(result.deaths.length, 2);
  assert.equal(result.gold_per_min[0].value, 850);
  assert.equal(result.xp_per_min[0].player.account_id, '2');
  assert.equal(result.net_worth[0].value, 45000);
  assert.equal(result.net_worth[0].match.id, '2');
});

test('duration buckets use exact boundaries and skip unknown duration', async () => {
  const { durationStats } = await load();
  const games = [1799, 1800, 2699, 2700, null].map((duration, index) => match(index, [player(1, 'radiant')], { duration }));
  const rows = durationStats(games, '1');
  assert.deepEqual(rows.map(row => row.games), [1, 2, 1]);
});

test('local dates exclude missing timestamps and daily streaks follow chronological order', async () => {
  const { localDay, matchesInRange, dailySummary } = await load();
  const games = [match(3, [player(1, 'radiant')], { started_at: '2026-10-20T20:00:00Z' }),
    match(1, [player(1, 'radiant')], { started_at: '2026-10-20T18:00:00Z' }),
    match(2, [player(1, 'radiant')], { started_at: '2026-10-20T19:00:00Z', winner: 'dire' }),
    match(4, [player(1, 'radiant')], { started_at: null })];
  assert.equal(localDay(null), null);
  const day = localDay(games[0].started_at);
  assert.equal(matchesInRange(games, day, day).length, 3);
  const row = dailySummary(games, day).players[0];
  assert.equal(row.games, 3); assert.equal(row.bestWins, 1); assert.equal(row.bestLosses, 1);
});
