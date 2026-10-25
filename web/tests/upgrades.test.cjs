const { test } = require('node:test');
const assert = require('node:assert/strict');

test('standard ability rank caps match the supplied table at every hero level', async () => {
  const { abilityUnlockLevel } = await import('../assets/inventory.js');
  const basicRequirements = [0, 1, 2, 3].map(rank => abilityUnlockLevel(5007, Array(rank).fill(5007)));
  const ultimateRequirements = [0, 1, 2].map(rank => abilityUnlockLevel(5010, Array(rank).fill(5010)));
  const basicCaps = [], ultimateCaps = [];
  for (let heroLevel = 1; heroLevel <= 30; heroLevel++) {
    basicCaps.push(basicRequirements.filter(level => level <= heroLevel).length);
    ultimateCaps.push(ultimateRequirements.filter(level => level <= heroLevel).length);
  }
  assert.deepEqual(basicCaps, [1,1,2,2,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4]);
  assert.deepEqual(ultimateCaps, [0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,3]);
});
test('ability requirements handle extended ranks, hero exceptions and unknown ranks', async () => {
  const { abilityUnlockLevel } = await import('../assets/inventory.js');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(rank => abilityUnlockLevel(5370, Array(rank).fill(5370))), [1, 3, 5, 7, 9, 11, 13]);
  assert.deepEqual([0, 1, 2].map(rank => abilityUnlockLevel(5433, Array(rank).fill(5433))), [4, 11, 18]);
  assert.equal(abilityUnlockLevel(5010, [5010, 5010, 5010]), null);
  assert.equal(abilityUnlockLevel(999999), null);
});

test('Scepter and Shard grants do not have a learnable rank; upgrades to existing skills remain learnable', async () => {
  const { abilityUnlockLevel } = await import('../assets/inventory.js');
  assert.equal(abilityUnlockLevel(419), null, 'Swift Slash is granted by Scepter');
  assert.equal(abilityUnlockLevel(944), null, 'Flame Cloak is granted by Scepter');
  assert.equal(abilityUnlockLevel(729), null, 'Depth Shroud is granted by Shard');
  assert.equal(abilityUnlockLevel(5024, [5024]), 3, 'Scepter upgrades Enchant Totem without replacing its rank progression');
});

test('linked forms share the learned rank instead of restarting from rank one', async () => {
  const { abilityUnlockLevel } = await import('../assets/inventory.js');
  assert.equal(abilityUnlockLevel(1502, [1498]), 3, 'Kez shares ranks between Echo Slash and Falcon Rush');
  assert.equal(abilityUnlockLevel(1504, [1500]), 3, 'Kez shares ranks between Kazurai Katana and Shodo Sai');
  assert.equal(abilityUnlockLevel(5056, [5055]), 3, 'Morphling shares Attribute Shift ranks');
});

test('helper actions tied to a learned skill do not spend their own skill points', async () => {
  const { abilityUnlockLevel } = await import('../assets/inventory.js');
  assert.equal(abilityUnlockLevel(5489), null, 'Break Tether is an auxiliary action');
  assert.equal(abilityUnlockLevel(6937), null, 'Tree Throw uses Tree Grab rather than learning its own ranks');
});
test('permanent Aghanim buffs do not require a nonzero stack count', async () => {
  const { aghanimState } = await import('../assets/inventory.js');
  const state = aghanimState({ permanent_buffs: [{ permanent_buff: 2, stack_count: 0 }, { permanent_buff: 12, stack_count: 0 }] });
  assert.equal(state.scepter.state, 'permanent'); assert.equal(state.shard.state, 'permanent');
});
test('backpack Scepter is owned but inactive; empty and missing data stay distinct', async () => {
  const { aghanimState } = await import('../assets/inventory.js');
  const empty = { permanent_buffs: [], ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`item_${i}`, 0])) };
  assert.equal(aghanimState(empty).scepter.state, 'absent');
  assert.equal(aghanimState({}).scepter.state, 'unknown');
  assert.equal(aghanimState({ ...empty, item_6: 108 }).scepter.state, 'backpack');
  assert.equal(aghanimState({ ...empty, item_0: 108 }).scepter.state, 'active');
  assert.equal(aghanimState({ ...empty, item_0: 609 }).shard.state, 'item');
});
