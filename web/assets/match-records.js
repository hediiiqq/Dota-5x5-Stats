import { element, heroBadge, steamProfileURL } from './common.js';
import { matchRecords, playerRecordLabels } from './insights.js';

const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function renderMatchRecords(match) {
  const root = element('section', 'match-records');
  root.setAttribute('aria-label', 'Рекорды матча');
  root.append(element('h2', 'match-records-title', 'Рекорды матча'),
    element('p', 'muted match-records-note', 'Максимумы среди участников этой игры. При равенстве показаны все лидеры.'));
  const data = matchRecords(match), grid = element('div', 'stats-grid');
  for (const [key, title] of Object.entries(playerRecordLabels)) {
    const panel = element('section', 'panel insight-record');
    panel.append(element('h3', '', title));
    const rows = data[key];
    if (!rows.length) {
      panel.append(element('p', 'muted', 'Нет данных'));
    } else {
      panel.append(element('p', 'stat-value', decimal.format(rows[0].value)));
      const list = element('ul', 'match-record-leaders');
      for (const { player } of rows) {
        const row = element('li', 'record-entry');
        const hasProfile = Boolean(steamProfileURL(player.account_id));
        const name = player.nickname || (hasProfile ? `ID ${player.account_id}` : 'Игрок со скрытым профилем');
        const identity = element(hasProfile ? 'a' : 'span', 'match-record-player', name);
        if (hasProfile) identity.href = `/?view=player&account_id=${encodeURIComponent(player.account_id)}`;
        row.append(heroBadge(player), identity);
        if (player.side === 'radiant' || player.side === 'dire') row.append(element('span', `badge ${player.side}`, player.side === 'radiant' ? 'Radiant' : 'Dire'));
        list.append(row);
      }
      panel.append(list);
      const available = (Array.isArray(match.players) ? match.players : []).filter(player => {
        const value = key === 'damage_per_min' ? player?.hero_damage : player?.[key];
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
      }).length;
      if (available < match.players.length) panel.append(element('p', 'muted small record-data-note', `Показатель доступен у ${available} из ${match.players.length} участников.`));
    }
    grid.append(panel);
  }
  root.append(grid);
  return root;
}
