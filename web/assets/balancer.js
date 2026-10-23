// Independent of the DOM and server: reusable in a standalone team picker.
export const ROLES = ['Керри', 'Мидер', 'Офлейнер', 'Саппорт', 'Хард-саппорт'];
export const FRIENDS_KEY = 'dota-stats:balancer:friends:v1';
export const RANK_MAX_AGE = 5 * 60 * 1000;

// Matches arrive newest first from the existing history endpoint.
export function databasePlayers(matches) {
  const records = new Map();
  for (const match of matches) {
    const seen = new Set();
    for (const player of Array.isArray(match?.players) ? match.players : []) {
      const id = typeof player?.account_id === 'string' ? parseAccountID(player.account_id) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = typeof player.nickname === 'string' ? player.nickname.trim().slice(0, 120) : '';
      if (!records.has(id)) records.set(id, { id, name: name || `ID ${id}`, games: 0 });
      const record = records.get(id);
      if (record.name === `ID ${id}` && name) record.name = name;
      record.games++;
    }
  }
  return [...records.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, 'ru'));
}

export function parseAccountID(value) {
  if (typeof value !== 'string') return null;
  let id = value.trim();
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    try {
      const url = new URL(id);
      if (url.protocol !== 'https:' || !['opendota.com', 'www.opendota.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
      id = /^\/players\/([1-9]\d{0,9})(?:\/[a-z-]+)?\/?$/.exec(url.pathname)?.[1];
    } catch { return null; }
  }
  return id && Number(id) <= 4294967295 ? id : null;
}

// Approximate community medal brackets, NOT exact MMR returned by OpenDota.
// API rank encoding: https://docs.opendota.com/ (rank_tier).
// Medal boundaries can drift; keep all assumptions in this single table.
const MEDALS = [
  ['Рекрут', [0, 154, 308, 462, 616, 770]],
  ['Страж', [770, 924, 1078, 1232, 1386, 1540]],
  ['Рыцарь', [1540, 1694, 1848, 2002, 2156, 2310]],
  ['Герой', [2310, 2464, 2618, 2772, 2926, 3080]],
  ['Легенда', [3080, 3234, 3388, 3542, 3696, 3850]],
  ['Властелин', [3850, 4004, 4158, 4312, 4466, 4620]],
  ['Божество', [4620, 4820, 5020, 5220, 5420, 5620]],
];

export function rankEstimate(tier) {
  if (!Number.isInteger(tier)) return null;
  if (tier === 80) return { label: 'Титан', min: 5620, max: null, mmr: 5620, kind: 'floor' };
  const medal = Math.floor(tier / 10), star = tier % 10;
  if (medal < 1 || medal > 7 || star < 1 || star > 5) return null;
  const [name, boundaries] = MEDALS[medal - 1];
  const min = boundaries[star - 1], max = boundaries[star];
  return { label: `${name} ${star}`, min, max, mmr: (min + max) / 2, kind: 'midpoint' };
}

export function playerEstimate(player) {
  const estimate = rankEstimate(player.rankTier);
  if (player.rankTier !== 80 || player.manualMMR == null) return estimate;
  if (!Number.isSafeInteger(player.manualMMR) || player.manualMMR <= 0) throw new Error(`${player.name || player.id}: укажите целый положительный MMR.`);
  return { ...estimate, mmr: player.manualMMR, kind: 'manual' };
}

function assignRoles(team) {
  const result = Array(5), used = new Set();
  const roleOrder = [1, 2, 3, 4, 5].sort((a, b) => team.filter(p => p.roles.includes(a)).length - team.filter(p => p.roles.includes(b)).length);
  function visit(index) {
    if (index === 5) return true;
    const role = roleOrder[index];
    for (const player of team) if (!used.has(player.id) && player.roles.includes(role)) {
      used.add(player.id); result[role - 1] = player.id;
      if (visit(index + 1)) return true;
      used.delete(player.id);
    }
    return false;
  }
  return visit(0) ? result : null;
}

export function balanceTeams(players) {
  if (!Array.isArray(players) || players.length !== 10) throw new Error('Выберите ровно 10 игроков.');
  if (new Set(players.map(p => p.id)).size !== 10) throw new Error('Нужны 10 различных игроков: ID не должны повторяться.');
  for (const player of players) {
    if (!playerEstimate(player)) throw new Error(`${player.name || player.id}: OpenDota не предоставляет ранг. Выберите другого игрока или обновите профиль позже.`);
    if (!Array.isArray(player.roles) || !player.roles.length || player.roles.some(r => !Number.isInteger(r) || r < 1 || r > 5)) throw new Error(`${player.name || player.id}: выберите допустимые позиции 1–5.`);
  }
  // Hall's condition catches combinations of preferences, not just empty roles.
  for (let mask = 1; mask < 32; mask++) {
    const roles = [1, 2, 3, 4, 5].filter(r => mask & (1 << (r - 1)));
    const available = players.filter(p => p.roles.some(r => roles.includes(r))).length;
    if (available < roles.length * 2) throw new Error(`Не хватает игроков на позиции ${roles.map(r => `${r} (${ROLES[r - 1]})`).join(', ')}: нужно ${roles.length * 2}, готовы играть ${available}. Измените участников или их позиции.`);
  }
  const variants = [];
  // Fix the first player in Radiant to avoid mirrored duplicates (252 / 2).
  for (let mask = 1; mask < 1024; mask += 2) {
    const left = players.filter((_, i) => mask & (1 << i));
    if (left.length !== 5) continue;
    const right = players.filter((_, i) => !(mask & (1 << i)));
    const radiant = assignRoles(left), dire = radiant && assignRoles(right);
    if (!radiant || !dire) continue;
    const radiantTotal = left.reduce((sum, p) => sum + playerEstimate(p).mmr, 0);
    const direTotal = right.reduce((sum, p) => sum + playerEstimate(p).mmr, 0);
    variants.push({ radiant, dire, radiantTotal, direTotal, difference: Math.abs(radiantTotal - direTotal) });
  }
  variants.sort((a, b) => a.difference - b.difference || a.radiant.join(',').localeCompare(b.radiant.join(',')));
  return { variants: variants.slice(0, 12), validPartitions: variants.length };
}

function safeAvatar(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

function cleanFriends(values) {
  if (!Array.isArray(values)) throw new Error('Неверный формат сохранённого списка.');
  const seen = new Set(), friends = [];
  for (const value of values.slice(0, 100)) {
    const id = value && parseAccountID(value.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    friends.push({ id, name: typeof value.name === 'string' ? value.name.slice(0, 120) : `Игрок ${id}`,
      avatar: safeAvatar(value.avatar), rankTier: rankEstimate(value.rankTier) ? value.rankTier : null,
      updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? value.updatedAt : 0,
      roles: [...new Set(Array.isArray(value.roles) ? value.roles.filter(r => Number.isInteger(r) && r >= 1 && r <= 5) : [])].sort(), selected: value.selected === true });
  }
  return friends;
}

export function loadFriends(storage = globalThis.localStorage) {
  try { const raw = storage.getItem(FRIENDS_KEY); return raw ? cleanFriends(JSON.parse(raw)) : []; }
  catch { throw new Error('Не удалось прочитать сохранённый список друзей. Можно продолжить в этой вкладке; проверьте доступ к хранилищу браузера.'); }
}

export function saveFriends(friends, storage = globalThis.localStorage) {
  try { storage.setItem(FRIENDS_KEY, JSON.stringify(cleanFriends(friends))); }
  catch { throw new Error('Не удалось сохранить список друзей. Изменения доступны в этой вкладке, но могут исчезнуть после перезагрузки.'); }
}

export function createOpenDotaClient({ fetcher = globalThis.fetch, minInterval = 1100, timeout = 12000 } = {}) {
  let queue = Promise.resolve(), lastRequest = 0;
  return function getProfile(id, { signal } = {}) {
    if (parseAccountID(id) !== id) return Promise.reject(new Error('Некорректный Dota ID.'));
    const request = queue.then(async () => {
      signal?.throwIfAborted();
      const delay = Math.max(0, minInterval - (Date.now() - lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      signal?.throwIfAborted();
      lastRequest = Date.now();
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
      let response, payload;
      try {
        response = await fetcher(`https://api.opendota.com/api/players/${id}`, { signal: requestSignal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (response.ok) payload = await response.json();
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw new Error(requestSignal.aborted ? 'OpenDota не ответила вовремя. Попробуйте ещё раз.' : 'Не удалось связаться с OpenDota. Проверьте подключение и повторите запрос.');
      }
      if (!response.ok) {
        if (response.status === 429) throw new Error('Достигнут лимит запросов OpenDota. Подождите минуту и повторите.');
        if (response.status === 404) throw new Error('Профиль не найден в OpenDota. Проверьте Dota ID.');
        throw new Error(`OpenDota временно недоступна (HTTP ${response.status}). Попробуйте позже.`);
      }
      if (!payload?.profile || String(payload.profile.account_id) !== id) throw new Error('OpenDota не вернула запрошенный профиль. Проверьте Dota ID.');
      return { id, name: typeof payload.profile.personaname === 'string' ? payload.profile.personaname.slice(0, 120) : `Игрок ${id}`,
        avatar: safeAvatar(payload.profile.avatarfull || payload.profile.avatarmedium), rankTier: rankEstimate(payload.rank_tier) ? payload.rank_tier : null, updatedAt: Date.now() };
    });
    queue = request.catch(() => {});
    return request;
  };
}
