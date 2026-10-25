const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const enabled = process.env.RUN_MIGRATION_TESTS === '1';
const root = path.resolve(__dirname, '../..');
const shell = process.env.SH_BIN || 'sh';
const psql = process.env.PSQL_BIN || 'psql';
let nextDatabase = 0;
let role;

function query(sql, database = 'postgres', allowFailure = false) {
  const result = spawnSync(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', database, '-f', '-'], {
    input: sql, encoding: 'utf8', timeout: 30000,
  });
  if (!allowFailure) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
  return result;
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-migrations-'));
  fs.mkdirSync(path.join(directory, 'deploy'));
  fs.copyFileSync(path.join(root, 'deploy/migrate.sh'), path.join(directory, 'deploy/migrate.sh'));
  fs.cpSync(path.join(root, 'migrations'), path.join(directory, 'migrations'), { recursive: true });
  const database = `dota_migration_test_${process.pid}_${++nextDatabase}`;
  query(`CREATE DATABASE ${database};`);
  t.after(() => {
    query(`DROP DATABASE ${database} WITH (FORCE);`);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseline = fs.readdirSync(path.join(directory, 'migrations'))
    .filter(name => /^00[1-4]_.*\.up\.sql$/.test(name)).sort()
    .map(name => fs.readFileSync(path.join(directory, 'migrations', name), 'utf8') + '\n;\n').join('\n');
  query(baseline, database);
  return { directory, database };
}

function generate(f, webRole = role) {
  return spawnSync(shell, [path.join(f.directory, 'deploy/migrate.sh').replaceAll('\\', '/'), '--sql'], {
    env: { ...process.env, DOTA_WEB_DB_ROLE: webRole }, encoding: 'utf8', timeout: 10000,
  });
}

function migrate(f, allowFailure = false, webRole = role) {
  const sql = generate(f, webRole);
  assert.ifError(sql.error);
  assert.equal(sql.status, 0, sql.stderr);
  return query(sql.stdout, f.database, allowFailure);
}

before(() => {
  if (!enabled) return;
  assert.ok(process.env.PGHOST, 'Use a dedicated test PostgreSQL server via PGHOST');
  role = `dota_web_test_${process.pid}`;
  query(`CREATE ROLE ${role} NOLOGIN;`);
});

after(() => {
  if (enabled) query(`DROP ROLE ${role};`);
});

test('applies auth migrations once, preserves sessions and grants only auth writes', { skip: !enabled }, t => {
  const f = fixture(t);
  migrate(f);
  assert.equal(query('SELECT count(*) FROM public.app_schema_migrations;', f.database).stdout.trim(), '2');
  query(`SET ROLE ${role};
    INSERT INTO public.admin_sessions(token_hash, steam_id64, expires_at) VALUES ('test-session', '76561198000000001', now() + interval '15 days');
    INSERT INTO public.admin_login_attempts(state_hash, browser_token_hash, return_to, expires_at) VALUES ('state', 'browser', 'https://example.com/auth/steam/callback', now() + interval '10 minutes');
    INSERT INTO public.admin_openid_nonces(nonce, expires_at) VALUES ('test-nonce', now() + interval '11 minutes');
    UPDATE public.admin_sessions SET revoked_at = now() WHERE token_hash = 'test-session';
    DELETE FROM public.admin_login_attempts WHERE state_hash = 'state';`, f.database);
  migrate(f);
  assert.equal(query('SELECT count(*) FROM public.admin_sessions;', f.database).stdout.trim(), '1');
  assert.equal(query('SELECT count(*) FROM public.app_schema_migrations;', f.database).stdout.trim(), '2');
  assert.equal(query(`SELECT has_table_privilege('${role}', 'public.matches', 'INSERT');`, f.database).stdout.trim(), 'f');
  assert.equal(query(`SELECT has_table_privilege('${role}', 'public.app_schema_migrations', 'UPDATE');`, f.database).stdout.trim(), 'f');
});

test('a failing migration rolls back schema, grants and migration history', { skip: !enabled }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'migrations/007_broken.up.sql'), 'CREATE TABLE public.should_rollback(id int); SELECT 1/0;');
  const result = migrate(f, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /division by zero/);
  assert.equal(query("SELECT to_regclass('public.admin_sessions') IS NULL AND to_regclass('public.app_schema_migrations') IS NULL AND to_regclass('public.should_rollback') IS NULL;", f.database).stdout.trim(), 't');
});

test('changing an already applied migration stops the deployment', { skip: !enabled }, t => {
  const f = fixture(t);
  migrate(f);
  fs.appendFileSync(path.join(f.directory, 'migrations/005_admin_auth.up.sql'), '\n-- changed after apply\n');
  const result = migrate(f, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Applied migration has changed/);
  assert.equal(query('SELECT count(*) FROM public.app_schema_migrations;', f.database).stdout.trim(), '2');
});

test('missing web role rolls back the entire migration batch', { skip: !enabled }, t => {
  const f = fixture(t);
  const result = migrate(f, true, `missing_web_role_${process.pid}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
  assert.equal(query("SELECT to_regclass('public.admin_sessions') IS NULL;", f.database).stdout.trim(), 't');
});

test('duplicate migration versions are rejected before execution', { skip: !enabled }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'migrations/006_duplicate.up.sql'), 'SELECT 1;');
  const result = generate(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate migration version/);
});

test('concurrent runners serialize and both finish without duplicate DDL', { skip: !enabled }, async t => {
  const f = fixture(t);
  const sql = generate(f);
  assert.equal(sql.status, 0, sql.stderr);
  function run() {
    return new Promise((resolve, reject) => {
      const process = spawn(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-d', f.database, '-f', '-']);
      let stderr = '';
      process.stderr.on('data', chunk => { stderr += chunk; });
      process.stdout.resume();
      process.on('error', reject);
      process.on('close', code => resolve({ code, stderr }));
      process.stdin.end(sql.stdout);
    });
  }
  for (const result of await Promise.all([run(), run()])) assert.equal(result.code, 0, result.stderr);
  assert.equal(query('SELECT count(*) FROM public.app_schema_migrations;', f.database).stdout.trim(), '2');
});
