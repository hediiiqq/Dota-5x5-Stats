const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../assets/balancer.js');
const players = () => Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: `Игрок ${i + 1}`, rankTier: 11 + i % 5, roles: [1, 2, 3, 4, 5], selected: true }));

test('database player choices deduplicate IDs, skip anonymous/invalid IDs and retain latest known names', async () => {
  const { databasePlayers } = await load();
  assert.deepEqual(databasePlayers([
    { players: [{ account_id: '123', nickname: 'Новое имя' }, { account_id: '123', nickname: 'Дубль' }, { account_id: '0' }, { account_id: null }] },
    { players: [{ account_id: '123', nickname: 'Старое имя' }, { account_id: '456', nickname: '' }, { account_id: '4294967296' }] },
    { players: null },
  ]), [{ id: '123', name: 'Новое имя', games: 2 }, { id: '456', name: 'ID 456', games: 1 }]);
});

test('accepts Dota IDs and OpenDota player links, rejects other hosts, SteamIDs and overflow', async () => {
  const { parseAccountID } = await load();
  for (const value of ['123', ' 123 ', 'https://www.opendota.com/players/123', 'https://opendota.com/players/123/overview?x=1']) assert.equal(parseAccountID(value), '123');
  for (const value of ['', '0', '-1', '1e3', '00123', '4294967296', '76561198000000000', 'https://evil.com/players/123', 'https://opendota.com.evil.com/players/123', 'https://user@opendota.com/players/123']) assert.equal(parseAccountID(value), null, value);
  assert.equal(parseAccountID('4294967295'), '4294967295');
});

test('rank estimates use star-specific midpoint; unknowns stay missing; Immortal is explicitly a floor', async () => {
  const { rankEstimate } = await load();
  assert.deepEqual([rankEstimate(11).min, rankEstimate(11).max, rankEstimate(11).mmr], [0, 154, 77]);
  assert.equal(rankEstimate(22).mmr, 1001);
  assert.equal(rankEstimate(75).mmr, 5520);
  assert.equal(rankEstimate(80).mmr, 5620);
  assert.equal(rankEstimate(80).kind, 'floor');
  for (const value of [null, undefined, 0, 10, 16, 79, 81, '22', NaN]) assert.equal(rankEstimate(value), null);
});

test('manual Immortal MMR overrides the floor in balancing and remains session-only', async () => {
  const { playerEstimate, balanceTeams, saveFriends, loadFriends } = await load();
  const immortal = { ...players()[0], rankTier: 80, manualMMR: 9000 };
  assert.equal(playerEstimate(immortal).mmr, 9000);
  assert.equal(playerEstimate(immortal).kind, 'manual');
  assert.equal(playerEstimate({ ...immortal, manualMMR: null }).mmr, 5620);
  assert.equal(playerEstimate({ ...immortal, rankTier: 11 }).mmr, 77);
  const input = players(); input[0] = immortal;
  const result = balanceTeams(input).variants[0];
  assert.equal(result.radiantTotal + result.direTotal, 9000 + input.slice(1).reduce((s, p) => s + playerEstimate(p).mmr, 0));
  let raw; const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
  saveFriends([immortal], storage);
  assert.equal(loadFriends(storage)[0].manualMMR, undefined);
  for (const invalid of [-1, 0, 1.5, '9000', Infinity]) assert.throws(() => balanceTeams([{ ...immortal, manualMMR: invalid }, ...input.slice(1)]), /MMR/);
});

test('covers every role once per team with ten distinct players and no mirrored partitions', async () => {
  const { balanceTeams } = await load();
  const input = players();
  const result = balanceTeams(input);
  assert.equal(result.validPartitions, 126);
  assert.equal(result.variants.length, 12);
  const keys = new Set();
  for (const v of result.variants) {
    assert.equal(new Set([...v.radiant, ...v.dire]).size, 10);
    for (const team of [v.radiant, v.dire]) team.forEach((id, i) => assert.ok(input.find(p => p.id === id).roles.includes(i + 1)));
    const key = v.radiant.slice().sort().join(','); assert.ok(!keys.has(key)); keys.add(key);
  }
  assert.equal(JSON.stringify(input), JSON.stringify(players()));
});

test('optimum agrees with independent exhaustive assignment search for flexible roles', async () => {
  const { balanceTeams, rankEstimate } = await load();
  const input = players().map((p, i) => ({ ...p, rankTier: [11, 22, 33, 44, 55, 61, 62, 71, 72, 75][i], roles: [i % 5 + 1, (i + 1) % 5 + 1] }));
  let best = Infinity;
  function oracle(slot, remaining, sum) {
    if (slot === 10) { best = Math.min(best, Math.abs(sum)); return; }
    const role = slot % 5 + 1;
    for (const p of remaining) if (p.roles.includes(role)) oracle(slot + 1, remaining.filter(q => q.id !== p.id), sum + (slot < 5 ? 1 : -1) * rankEstimate(p.rankTier).mmr);
  }
  oracle(0, input, 0);
  assert.equal(balanceTeams(input).variants[0].difference, best);
});

test('detects both missing roles and overlapping preference conflicts', async () => {
  const { balanceTeams } = await load();
  assert.throws(() => balanceTeams(players().map(p => ({ ...p, roles: [1, 2, 3, 4] }))), /5.*Хард|Хард.*5/);
  // Three roles require six players, but only five players can fill them.
  const overlapping = players().map((p, i) => ({ ...p, roles: i < 5 ? [1, 2, 3] : [4, 5] }));
  assert.throws(() => balanceTeams(overlapping), /6.*5|5.*6/);
});

test('rejects invalid count, duplicates, missing ranks and empty/invalid roles before solving', async () => {
  const { balanceTeams } = await load();
  assert.throws(() => balanceTeams(players().slice(0, 9)), /10/);
  const duplicate = players(); duplicate[9].id = '1'; assert.throws(() => balanceTeams(duplicate), /повтор|различ/i);
  const missing = players(); missing[0].rankTier = null; assert.throws(() => balanceTeams(missing), /ранг/i);
  missing[0].rankTier = 11; missing[0].roles = []; assert.throws(() => balanceTeams(missing), /позици/i);
  missing[0].roles = [6]; assert.throws(() => balanceTeams(missing), /позици/i);
});

test('storage persists profiles and roles but never derived or user-supplied MMR', async () => {
  const { saveFriends, loadFriends } = await load();
  let value; const storage = { getItem: () => value, setItem: (_, v) => { value = v; } };
  saveFriends([{ ...players()[0], mmr: 10000, roles: [1, 1, 3], updatedAt: 123, avatar: 'javascript:alert(1)' }], storage);
  assert.ok(!value.includes('mmr'));
  assert.deepEqual(loadFriends(storage)[0].roles, [1, 3]);
  assert.equal(loadFriends(storage)[0].avatar, null);
  value = '{bad'; assert.throws(() => loadFriends(storage), /сохран/i);
  value = JSON.stringify([players()[0], players()[0]]); assert.equal(loadFriends(storage).length, 1);
  assert.throws(() => saveFriends(players(), { setItem() { throw new Error('quota'); } }), /сохран/i);
});

test('OpenDota profile loader handles identity, missing rank, rate limit and network failure', async () => {
  const { createOpenDotaClient } = await load();
  let url;
  const client = createOpenDotaClient({ minInterval: 0, fetcher: async u => { url = u; return { ok: true, json: async () => ({ rank_tier: 22, profile: { account_id: 123, personaname: '<img onerror=alert(1)>', avatarfull: 'https://cdn.example/avatar.png' } }) }; } });
  const p = await client('123');
  assert.equal(url, 'https://api.opendota.com/api/players/123'); assert.equal(p.rankTier, 22); assert.equal(p.name, '<img onerror=alert(1)>');
  const mismatch = createOpenDotaClient({ minInterval: 0, fetcher: async () => ({ ok: true, json: async () => ({ profile: { account_id: 124 } }) }) });
  await assert.rejects(mismatch('123'), /профил/i);
  const unknown = createOpenDotaClient({ minInterval: 0, fetcher: async () => ({ ok: true, json: async () => ({ profile: { account_id: 123 }, rank_tier: null }) }) });
  assert.equal((await unknown('123')).rankTier, null);
  const limited = createOpenDotaClient({ minInterval: 0, fetcher: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(limited('123'), /лимит/i);
  const offline = createOpenDotaClient({ minInterval: 0, fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline('123'), /OpenDota/);
});
