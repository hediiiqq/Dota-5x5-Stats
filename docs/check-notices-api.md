# Проверка API плашек в браузере

Запускать после деплоя новых маршрутов и миграции 007. Открыть
https://dota-stats5x5.duckdns.org/?view=admin, войти через Steam, затем открыть
F12 → Console. Запросы выполняются с того же сайта: браузер сам отправляет cookie
и Origin. Cookie вручную копировать не нужно. CSRF-токен не публиковать.

Проверки ниже создают настоящую тестовую плашку, затем удаляют её.
Запускать блоки по очереди. Если создание не вернуло 201, остановиться и проверить ответ.

## 1. Подготовка

```javascript
var sessionResponse = await fetch('/api/admin/session', {
  credentials: 'same-origin', cache: 'no-store'
});
if (!sessionResponse.ok) throw new Error('Сначала войди в админку: HTTP ' + sessionResponse.status);
var session = await sessionResponse.json();
if (!session.csrf_token) throw new Error('API сессии не вернул CSRF-токен');

window.noticesRequest = async function (method, path, body) {
  var headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = session.csrf_token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  var response = await fetch(path, {
    method, headers, credentials: 'same-origin', cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  var raw = await response.text();
  var data = raw ? JSON.parse(raw) : null;
  console.log(method, path, response.status, data);
  return {status: response.status, data};
};
```

Вставить весь блок подготовки целиком, включая функцию. Ответ undefined после
объявления — нормален. После перезагрузки страницы блок нужно выполнить заново.

## 2. Список — 200

```javascript
await noticesRequest('GET', '/api/notices');
await noticesRequest('GET', '/api/admin/notices');
```

При пустой таблице ожидается {"items": []}.

## 3. Создание — 201

```javascript
var created = await noticesRequest('POST', '/api/admin/notices', {
  text: 'Тест API плашек — 26.10.2026'
});
if (created.status !== 201 || !created.data?.id) throw new Error('Плашка не создана');
var noticePath = '/api/admin/notices/' + encodeURIComponent(created.data.id);
await noticesRequest('GET', '/api/notices');
```

В ответе — id строкой и text. Плашка должна появиться в начале списка.

## 4. Изменение — 200

```javascript
await noticesRequest('PUT', noticePath, {
  text: 'Тест API: текст изменён — 26.10.2026'
});
await noticesRequest('GET', '/api/notices');
```

ID сохраняется, текст меняется. Дата входит в текст.

## 5. Неверный текст — 400

```javascript
await noticesRequest('POST', '/api/admin/notices', {text: '   '});
await noticesRequest('POST', '/api/admin/notices', {text: 'я'.repeat(501)});
```

Ожидается error.code = invalid_request; новые записи не создаются.

## 6. Запрос без CSRF — 403

```javascript
var noCsrf = await fetch('/api/admin/notices', {
  method: 'POST', credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({text: 'Эта плашка не должна сохраниться'})
});
console.log(noCsrf.status, await noCsrf.json());
```

При действующей административной сессии ожидается 403, csrf_invalid.

## 7. Удаление — 204, повторное удаление — 404

```javascript
await noticesRequest('DELETE', noticePath);
await noticesRequest('DELETE', noticePath);
await noticesRequest('GET', '/api/notices');
```

Первый ответ без тела. Второй — notice_not_found. Тестовой плашки больше нет.

## 8. Проверка без входа

Открыть сайт в приватном окне без авторизации и выполнить в консоли:

```javascript
var publicList = await fetch('/api/notices');
console.log(publicList.status, await publicList.json());
var adminList = await fetch('/api/admin/notices');
console.log(adminList.status, await adminList.json());
```

Публичный список — 200; административный — 401, unauthenticated.

Если API возвращает 500, смотреть журналы сервера: проверить миграцию 007 и права
роли приложения. Ответ 404 на сам маршрут после деплоя может означать откат на
предыдущий образ. Эти запросы проверяют API отдельно от редактора плашек.
