const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = () => ({ value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } });
test('favorites persist exact bigint IDs and plain-text notes, and can be removed', async () => {
  const { readFavorites, saveFavorite } = await import('../assets/favorites.js');
  const storage = store();
  saveFavorite('9007199254740993', { note: '<script>x</script>', saved: true }, storage);
  assert.equal(readFavorites(storage)['9007199254740993'].note, '<script>x</script>');
  saveFavorite('9007199254740993', { saved: false }, storage);
  assert.deepEqual(readFavorites(storage), {});
});
test('corrupt storage and blocked writes fail explicitly without overwriting data', async () => {
  const { readFavorites, saveFavorite } = await import('../assets/favorites.js');
  const storage = store(); storage.value = '{broken';
  assert.throws(() => readFavorites(storage));
  assert.throws(() => saveFavorite('1', { saved: true, note: '' }, storage));
  assert.equal(storage.value, '{broken');
  assert.throws(() => saveFavorite('1', { saved: true }, { getItem: () => null, setItem() { throw Error('blocked'); } }));
});
