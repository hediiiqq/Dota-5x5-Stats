import { element, image, number } from './common.js';
import { ROLES, RANK_MAX_AGE, parseAccountID, rankEstimate, playerEstimate, balanceTeams, databasePlayers, loadFriends, saveFriends, createProfileClient } from './balancer.js';

function button(text, action, className = '') {
  const node = element('button', `button ${className}`, text);
  node.type = 'button'; node.addEventListener('click', action); return node;
}

function identity(player) {
  const node = element('div', 'balance-identity');
  const avatar = element('span', 'balance-avatar', player.name.trim().slice(0, 2).toUpperCase() || '?');
  const img = image(player.avatar, '', '', 32);
  if (img) avatar.append(img);
  const text = element('div', 'balance-person');
  const name = element('a', 'balance-name', player.name);
  const source = player.source === 'stratz' ? 'STRATZ' : 'OpenDota';
  name.href = player.source === 'stratz' ? `https://stratz.com/players/${player.id}` : `https://www.opendota.com/players/${player.id}`; name.target = '_blank'; name.rel = 'noopener noreferrer';
  name.title = `${player.name} · ${source}`;
  const estimate = playerEstimate(player);
  text.append(name, element('span', 'muted small', estimate ? `${estimate.label} · ${estimate.kind === 'floor' ? '≥ ' : estimate.kind === 'manual' ? '' : '≈ '}${number(estimate.mmr)} MMR${estimate.kind === 'manual' ? ' (вручную)' : ''}` : 'Ранг недоступен'));
  if (player.source) text.append(element('span', 'muted small', source));
  node.append(avatar, text); return node;
}

function roleChoices(roles, prefix, onChange, disabled = false) {
  const group = element('fieldset', 'balance-role-choices');
  group.disabled = disabled;
  group.append(element('legend', 'sr-only', 'Допустимые позиции'));
  ROLES.forEach((name, index) => {
    const label = element('label', 'balance-role-choice');
    const input = element('input'); input.type = 'checkbox'; input.value = String(index + 1);
    input.id = `${prefix}-role-${index + 1}`; input.checked = roles.includes(index + 1);
    input.setAttribute('aria-label', `${index + 1} — ${name}`);
    input.addEventListener('change', () => onChange(index + 1, input.checked));
    label.append(input, element('span', '', String(index + 1))); label.title = `${index + 1} — ${name}`;
    group.append(label);
  });
  return group;
}

export function renderBalancer(root, { getProfile = createProfileClient(), getDatabaseMatches, loadDatabaseAvatars } = {}) {
  let friends = [], busy = false, variants = [], current = null, swapFrom = null, manual = false;
  let storageError = '';
  try { friends = loadFriends(); } catch (error) { storageError = error.message; }
  const controller = new AbortController();
  // BFCache restores this same screen and its signal. Keep it usable on Back.
  globalThis.addEventListener('pagehide', event => { if (!event.persisted) controller.abort(); });
  root.replaceChildren(); root.className = 'balance-screen';
  const status = element('p', 'balance-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const storageNote = element('p', 'balance-warning small'); storageNote.setAttribute('role', 'status');
  const toolbar = element('div', 'balance-toolbar');
  const selection = element('p', 'balance-selection');
  const actions = element('div', 'balance-actions');
  const refresh = button('Обновить ранги', () => runRefresh());
  const build = button('Собрать команды', () => generate(), 'balance-primary');
  actions.append(refresh, build); toolbar.append(selection, actions);
  const grid = element('div', 'balance-grid');
  const roster = element('section', 'panel balance-friends'); roster.setAttribute('aria-labelledby', 'balance-friends-title');
  const heading = element('div', 'panel-heading');
  const rosterTitle = element('h2', '', 'Друзья'); rosterTitle.id = 'balance-friends-title';
  const total = element('span', 'muted small'); heading.append(rosterTitle, total);
  const form = element('form', 'balance-add');
  const fields = element('fieldset', 'balance-add-fields');
  let database = [], databaseLoaded = false, databaseLoading = false;
  const databasePicker = element('div', 'balance-database');
  const databaseToggle = button('Выбрать из базы', loadDatabase);
  databaseToggle.setAttribute('aria-controls', 'balance-database-choices');
  databaseToggle.setAttribute('aria-expanded', 'false');
  const databaseContent = element('div', 'balance-database-choices'); databaseContent.id = 'balance-database-choices'; databaseContent.hidden = true;
  const databaseStatus = element('p', 'muted small'); databaseStatus.setAttribute('role', 'status');
  const databaseSearchLabel = element('label', 'sr-only', 'Найти игрока в базе по нику или Dota ID'); databaseSearchLabel.htmlFor = 'balance-database-search';
  const databaseSearch = element('input', 'stats-select'); databaseSearch.type = 'search'; databaseSearch.id = 'balance-database-search';
  databaseSearch.placeholder = 'Поиск по нику или Dota ID'; databaseSearch.hidden = true;
  databaseSearch.addEventListener('input', renderDatabase);
  const databaseList = element('ul', 'balance-database-list'); databaseList.id = 'balance-database-list'; databaseList.setAttribute('aria-label', 'Игроки из сохранённых матчей');
  databaseContent.append(databaseStatus, databaseSearchLabel, databaseSearch, databaseList);
  databasePicker.append(databaseToggle, databaseContent);
  if (getDatabaseMatches) fields.append(databasePicker);
  const inputLabel = element('label', '', 'Dota ID или ссылка OpenDota'); inputLabel.htmlFor = 'balance-account';
  const input = element('input', 'stats-select'); input.id = 'balance-account'; input.name = 'account'; input.type = 'text';
  input.placeholder = 'Например, 123456789'; input.required = true; input.maxLength = 250;
  input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-describedby', 'balance-add-error');
  const formRoles = new Set();
  const rolesLabel = element('p', 'muted small', 'На каких позициях готов играть?');
  const choices = roleChoices([], 'balance-add', (role, checked) => checked ? formRoles.add(role) : formRoles.delete(role));
  const add = element('button', 'button', 'Добавить друга'); add.type = 'submit';
  const addError = element('p', 'balance-warning small'); addError.id = 'balance-add-error'; addError.setAttribute('role', 'status');
  fields.append(inputLabel, input, rolesLabel, choices, add, addError); form.append(fields);
  const searchLabel = element('label', 'sr-only', 'Найти друга по имени или Dota ID'); searchLabel.htmlFor = 'balance-search';
  const search = element('input', 'stats-select'); search.type = 'search'; search.id = 'balance-search'; search.placeholder = 'Найти друга по имени или ID';
  search.addEventListener('input', renderRoster);
  const searchWrap = element('div', 'balance-search'); searchWrap.append(searchLabel, search);
  const list = element('ul', 'balance-friends-list'); list.setAttribute('aria-label', 'Друзья и их допустимые позиции');
  roster.append(heading, form, searchWrap, list);
  const result = element('section', 'balance-result'); result.setAttribute('aria-labelledby', 'balance-results-title');
  grid.append(roster, result);
  const details = element('details', 'balance-method panel');
  details.append(element('summary', '', 'Как считаем баланс'));
  const explanation = element('div', 'balance-method-body');
  explanation.append(element('p', '', 'Сначала закрываем позиции 1–5 в каждой команде. Затем среди всех допустимых разбиений выбираем минимальную разницу среднего примерного MMR. Средний MMR команды — сумма оценок пяти игроков, делённая на пять. Позиции равноправны: порядок выбора не задаёт приоритет.'),
    element('p', '', 'MMR — середина приблизительного диапазона медали и звёзд, а не точный рейтинг. Границы могут меняться. Для Титана можно указать MMR вручную в списке друзей. Ручное значение действует в этой вкладке и не сохраняется. Если поле пустое, используется нижняя граница 5 620 MMR. Игроки без доступного ранга не участвуют в расчёте.'),
    element('p', '', 'Ранги обновляем перед расчётом, если с последней загрузки прошло больше пяти минут. «Обновить ранги» принудительно обновляет выбранных игроков. Основной источник — OpenDota; при временном сбое сервер автоматически использует STRATZ, если он настроен. Источник указан под рангом игрока. Оба сервиса могут показывать устаревшую медаль. Запросы идут последовательно; при сбоях обновление занимает больше времени.'),
    element('p', '', 'Друзья, выбранные позиции и последний ответ о ранге сохраняются только в этом браузере. MMR вычисляется заново и не сохраняется. После очистки данных браузера список исчезнет.'));
  const apiLink = element('a', '', 'Документация OpenDota'); apiLink.href = 'https://docs.opendota.com/'; apiLink.target = '_blank'; apiLink.rel = 'noopener noreferrer'; explanation.append(apiLink);
  details.append(explanation); root.append(toolbar, status, storageNote, grid, details);

  function message(text = '', error = false) { status.textContent = text; status.className = `balance-status${error ? ' balance-warning' : ''}`; }
  function persist() {
    try { saveFriends(friends); storageError = ''; } catch (error) { storageError = error.message; }
    storageNote.textContent = storageError;
  }
  function selected() { return friends.filter(p => p.selected); }
  function renderDatabase() {
    databaseList.replaceChildren();
    if (!databaseLoaded) return;
    const query = databaseSearch.value.trim().toLocaleLowerCase('ru');
    const visible = database.filter(p => `${p.name} ${p.id}`.toLocaleLowerCase('ru').includes(query));
    databaseStatus.textContent = !database.length ? 'Нет игроков с Dota ID в сохранённых матчах. Можно добавить друга вручную.'
      : !visible.length ? 'Никого не нашли. Попробуйте другой ник или ID.'
      : `Игроков: ${visible.length}`;
    for (const player of visible) {
      const row = element('li', 'balance-database-player');
      const avatar = element('span', 'balance-avatar', player.name.trim().slice(0, 2).toUpperCase() || '?');
      avatar.setAttribute('aria-hidden', 'true');
      avatar.setAttribute('data-avatar-account', player.id);
      const text = element('div', 'balance-person');
      text.append(element('span', 'balance-name', player.name), element('span', 'muted small', `ID ${player.id} · матчей: ${number(player.games)}`));
      const exists = friends.some(p => p.id === player.id);
      const choose = button(exists ? 'Уже добавлен' : 'Выбрать', () => {
        input.value = player.id; addError.textContent = '';
        message(`Выбран ${player.name} · ID ${player.id}. Укажите позиции и нажмите «Добавить друга».`);
        document.getElementById('balance-add-role-1')?.focus();
      }, 'button-quiet');
      choose.disabled = exists; choose.setAttribute('aria-label', `${exists ? 'Уже добавлен' : 'Выбрать'}: ${player.name}, ID ${player.id}`);
      row.append(avatar, text, choose); databaseList.append(row);
    }
    // Reuse the existing cached Steam avatar loader; missing images keep initials.
    if (loadDatabaseAvatars) void Promise.resolve(loadDatabaseAvatars(databaseList, controller.signal)).catch(() => {});
  }
  async function loadDatabase() {
    if (databaseLoading || busy) return;
    databaseLoading = true; databaseLoaded = false; database = []; databaseList.replaceChildren();
    databaseContent.hidden = false; databaseSearch.hidden = true;
    databaseToggle.disabled = true; databaseToggle.setAttribute('aria-expanded', 'true');
    databaseStatus.textContent = 'Загружаем игроков из сохранённых матчей…';
    databaseStatus.className = 'muted small';
    try {
      const matches = await getDatabaseMatches(controller.signal, count => {
        if (!controller.signal.aborted) databaseStatus.textContent = `Загружено матчей: ${number(count)}…`;
      });
      if (controller.signal.aborted) return;
      database = databasePlayers(matches); databaseLoaded = true; databaseSearch.hidden = !database.length;
      databaseToggle.textContent = 'Обновить список из базы'; renderDatabase();
    } catch (error) {
      if (!controller.signal.aborted) { databaseStatus.textContent = `${error.message} Повторите загрузку или добавьте игрока по Dota ID.`; databaseStatus.className = 'balance-warning small'; }
    } finally { databaseLoading = false; databaseToggle.disabled = false; }
  }
  function invalidate() { variants = []; current = null; swapFrom = null; manual = false; message(); renderResults(); }
  function updateToolbar() {
    const count = selected().length;
    selection.replaceChildren(element('strong', '', `${count} / 10`), element('span', 'muted', ' игроков выбрано'));
    build.disabled = busy || count !== 10; refresh.disabled = busy || !count;
    fields.disabled = busy;
    build.textContent = busy ? 'Подготовка…' : 'Собрать команды';
    build.title = count === 10 ? '' : 'Для расчёта выберите ровно десять игроков.';
    root.setAttribute('aria-busy', String(busy));
  }
  function renderRoster() {
    const activeID = document.activeElement?.id;
    total.textContent = `${friends.length} / 100`;
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase('ru');
    const visible = friends.filter(p => `${p.name} ${p.id}`.toLocaleLowerCase('ru').includes(query));
    if (!visible.length) list.append(element('li', 'balance-empty', friends.length ? 'Никого не нашли. Попробуйте другое имя или ID.' : 'Добавьте друзей, укажите их позиции и выберите десятерых для игры.'));
    for (const player of visible) {
      const row = element('li', `balance-friend${player.selected ? ' is-selected' : ''}`);
      const top = element('div', 'balance-friend-top');
      const check = element('input'); check.type = 'checkbox'; check.id = `balance-select-${player.id}`;
      check.checked = player.selected; check.disabled = busy; check.setAttribute('aria-label', `Включить в состав: ${player.name}`);
      check.addEventListener('change', () => { player.selected = check.checked; invalidate(); persist(); renderRoster(); });
      const remove = button('×', () => { friends = friends.filter(p => p.id !== player.id); invalidate(); persist(); renderRoster(); });
      remove.className = 'button button-quiet balance-remove'; remove.disabled = busy;
      remove.setAttribute('aria-label', `Удалить друга: ${player.name}`); remove.title = 'Удалить из списка друзей';
      top.append(check, identity(player), remove);
      const bottom = element('div', 'balance-friend-bottom');
      bottom.append(element('span', 'muted small', 'Позиции'), roleChoices(player.roles, `balance-${player.id}`, (role, checked) => {
        player.roles = checked ? [...player.roles, role].sort() : player.roles.filter(r => r !== role);
        invalidate(); persist(); renderRoster();
      }, busy));
      const stamp = element('span', 'muted small balance-freshness', player.updatedAt ? `Загружен ${new Date(player.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Нужно обновить ранг');
      stamp.title = player.updatedAt ? new Date(player.updatedAt).toLocaleString('ru-RU') : '';
      bottom.append(stamp); row.append(top, bottom);
      if (player.rankTier === 80) {
        const rating = element('div', 'balance-manual-rating');
        const label = element('label', 'small', 'MMR Титана'); label.htmlFor = `balance-mmr-${player.id}`;
        const field = element('input', 'stats-select'); field.id = label.htmlFor; field.type = 'number'; field.min = '1'; field.step = '1';
        field.inputMode = 'numeric'; field.placeholder = 'Например, 9000'; field.value = player.manualMMR == null ? '' : String(player.manualMMR); field.disabled = busy;
        const note = element('span', 'muted small', 'Только в этой вкладке. Пусто — оценка 5 620.'); note.id = `balance-mmr-note-${player.id}`;
        field.setAttribute('aria-describedby', note.id);
        field.addEventListener('change', () => {
          const raw = field.value.trim(), value = Number(raw);
          if (field.validity?.badInput || (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0))) {
            field.value = player.manualMMR == null ? '' : String(player.manualMMR);
            message(`${player.name}: укажите целый положительный MMR.`, true); return;
          }
          if (raw) player.manualMMR = value; else delete player.manualMMR;
          invalidate(); renderRoster();
        });
        rating.append(label, field, note); row.append(rating);
      }
      list.append(row);
    }
    updateToolbar();
    renderDatabase();
    if (activeID) document.getElementById(activeID)?.focus({ preventScroll: true });
  }
  async function refreshPlayers(force = false) {
    const updates = selected().filter(p => force || !p.updatedAt || Date.now() - p.updatedAt > RANK_MAX_AGE || p.updatedAt > Date.now());
    for (let index = 0; index < updates.length; index++) {
      const player = updates[index]; message(`Обновляем ранги: ${index + 1} / ${updates.length} · ${player.name}`);
      try {
        Object.assign(player, await getProfile(player.id, { signal: controller.signal }));
        if (player.rankTier !== 80) delete player.manualMMR;
      }
      catch (error) {
        player.updatedAt = 0; persist(); renderRoster();
        throw new Error(`${player.name}: ${error.message} Команды не рассчитаны по устаревшим данным.`);
      }
      persist(); renderRoster();
    }
    return updates.length;
  }
  async function runRefresh() {
    if (busy || !selected().length) return;
    busy = true; invalidate(); renderRoster();
    try { await refreshPlayers(true); message('Ранги выбранных игроков обновлены. Можно собрать команды.'); }
    catch (error) { if (!controller.signal.aborted) message(error.message, true); }
    finally { busy = false; renderRoster(); }
  }
  async function generate() {
    if (busy || selected().length !== 10) return;
    busy = true; invalidate(); renderRoster();
    try {
      await refreshPlayers();
      const calculated = balanceTeams(selected()); variants = calculated.variants;
      if (!variants.length) throw new Error('Не удалось закрыть все позиции. Измените участников или их позиции.');
      current = structuredClone(variants[0]);
      message(`Готово. Допустимых разбиений: ${calculated.validPartitions}. Показаны ${variants.length} лучших.`);
      renderResults();
    } catch (error) { if (!controller.signal.aborted) message(error.message, true); }
    finally { busy = false; renderRoster(); }
  }
  function renderResults() {
    const activeID = document.activeElement?.id;
    result.replaceChildren();
    const resultHeading = element('div', 'balance-result-heading');
    const title = element('h2', '', 'Составы команд'); title.id = 'balance-results-title';
    resultHeading.append(title);
    if (current) {
      const label = element('label', 'balance-variant-label', 'Вариант'); label.htmlFor = 'balance-variant';
      const select = element('select', 'stats-select'); select.id = 'balance-variant';
      variants.forEach((v, index) => { const option = element('option', '', `${index + 1} · разница средних ${number(v.difference / 5)}`); option.value = String(index); select.append(option); });
      if (manual) { const option = element('option', '', 'Ручная расстановка'); option.value = 'manual'; select.append(option); select.value = 'manual'; }
      else select.value = String(variants.findIndex(v => v.radiant.join(',') === current.radiant.join(',')));
      select.addEventListener('change', () => { if (select.value === 'manual') return; current = structuredClone(variants[Number(select.value)]); swapFrom = null; manual = false; renderResults(); });
      label.append(select); resultHeading.append(label);
    }
    result.append(resultHeading);
    const people = new Map(friends.map(p => [p.id, p]));
    const averages = current ? ['radiant', 'dire'].map(side => current[side].reduce((sum, id) => sum + playerEstimate(people.get(id)).mmr, 0) / current[side].length) : null;
    const summary = element('div', 'balance-difference');
    summary.append(element('span', 'muted', 'Разница среднего MMR команд'), element('strong', '', averages ? number(Math.abs(averages[0] - averages[1])) : '—'));
    result.append(summary);
    const teams = element('div', 'balance-teams');
    let violations = 0;
    ['radiant', 'dire'].forEach((side, sideIndex) => {
      const team = element('section', `panel balance-team ${side}`); team.setAttribute('aria-label', side === 'radiant' ? 'Команда Radiant' : 'Команда Dire');
      const teamHeader = element('div', 'balance-team-heading');
      teamHeader.append(element('h3', '', side === 'radiant' ? 'Radiant' : 'Dire'), element('span', 'balance-total', averages ? `Средний ≈ ${number(averages[sideIndex])} MMR` : 'Средний MMR —'));
      team.append(teamHeader);
      const lineup = element('ol', 'balance-lineup');
      ROLES.forEach((role, index) => {
        const row = element('li', 'balance-slot');
        const position = element('div', 'balance-position'); position.append(element('strong', '', String(index + 1)), element('span', '', role));
        row.append(position);
        const player = current && people.get(current[side][index]);
        if (player) {
          row.append(identity(player));
          const isFrom = swapFrom?.side === side && swapFrom.index === index;
          const swap = button(isFrom ? 'Отмена' : swapFrom ? 'Сюда' : 'Поменять', () => {
            if (!swapFrom) swapFrom = { side, index };
            else if (isFrom) swapFrom = null;
            else {
              const from = current[swapFrom.side];
              [from[swapFrom.index], current[side][index]] = [current[side][index], from[swapFrom.index]];
              manual = true; swapFrom = null;
            }
            renderResults();
          }, 'button-quiet balance-swap');
          swap.id = `balance-swap-${side}-${index}`; swap.setAttribute('aria-label', `${swap.textContent}: ${player.name}, ${role}, ${side}`); swap.setAttribute('aria-pressed', String(isFrom)); row.append(swap);
          if (!player.roles.includes(index + 1)) { row.className += ' balance-slot-conflict'; row.append(element('span', 'balance-warning small', 'Позиция не выбрана игроком')); violations++; }
        } else row.append(element('span', 'muted balance-unfilled', 'Место свободно'));
        lineup.append(row);
      });
      team.append(lineup); teams.append(team);
    });
    result.append(teams);
    const help = element('p', `${violations ? 'balance-warning' : 'muted'} small balance-result-note`);
    help.setAttribute('role', 'status');
    help.textContent = !current ? 'Выберите десятерых слева и нажмите «Собрать команды». В каждой команде будет по одному игроку на позициях 1–5.'
      : violations ? `Ручная расстановка: нарушений позиций — ${violations}. Поменяйте игроков или выберите один из рассчитанных вариантов.`
      : swapFrom ? 'Выберите второе место для обмена — в этой или другой команде. Можно поменять роли внутри команды.'
      : 'Все позиции закрыты. Для ручной перестановки нажмите «Поменять» у двух игроков.';
    result.append(help);
    if (current && [...current.radiant, ...current.dire].some(id => playerEstimate(people.get(id)).kind === 'floor')) result.append(element('p', 'balance-warning small', 'В составах есть Титан: для него взята нижняя граница 5 620 MMR. Разница команд менее надёжна.'));
    if (activeID) document.getElementById(activeID)?.focus({ preventScroll: true });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const id = parseAccountID(input.value); addError.textContent = '';
    if (!id) { addError.textContent = 'Введите Dota ID (не SteamID64) или ссылку https://www.opendota.com/players/ID.'; input.focus(); return; }
    if (friends.some(p => p.id === id)) { addError.textContent = 'Этот игрок уже есть в списке друзей.'; return; }
    if (!formRoles.size) { addError.textContent = 'Выберите хотя бы одну позицию для друга.'; return; }
    if (friends.length >= 100) { addError.textContent = 'В списке уже 100 друзей. Удалите ненужного игрока перед добавлением.'; return; }
    busy = true; renderRoster(); add.textContent = 'Загружаем профиль…';
    try {
      const profile = await getProfile(id, { signal: controller.signal });
      friends.push({ ...profile, roles: [...formRoles].sort(), selected: selected().length < 10 });
      input.value = ''; formRoles.clear();
      for (const checkbox of choices.querySelectorAll('input')) checkbox.checked = false;
      invalidate(); persist();
      message(rankEstimate(profile.rankTier) ? `${profile.name} добавлен в список друзей.` : `${profile.name} добавлен, но ранг недоступен. Для расчёта нужен доступный ранг.`, !rankEstimate(profile.rankTier));
    } catch (error) { if (!controller.signal.aborted) addError.textContent = error.message; }
    finally { busy = false; add.textContent = 'Добавить друга'; renderRoster(); input.focus(); }
  });
  storageNote.textContent = storageError; renderRoster(); renderResults();
}
