const { test } = require('node:test');
const assert = require('node:assert/strict');
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
