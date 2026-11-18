import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { createSignInServer, parsePort } from '../../scripts/dev/sign-in.mjs';
import {
  createSignInClient,
  publicConfig,
  signInMessage,
} from '../../scripts/dev/sign-in/client.mjs';

const configuration = {
  apiKey: 'public-test-key',
  authDomain: 'blogpost-staging.firebaseapp.com',
  projectId: 'blogpost-staging',
};
function fixture() {
  const calls = [];
  const token = {
    token: 'synthetic.payload.signature',
    expirationTime: new Date(Date.now() + 3_600_000).toISOString(),
    claims: {
      aud: configuration.projectId,
      iss: `https://securetoken.google.com/${configuration.projectId}`,
      sub: 'synthetic-uid',
      email: 'synthetic@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    },
  };
  const user = {
    uid: 'synthetic-uid',
    email: 'synthetic@example.invalid',
    emailVerified: true,
    async getIdTokenResult(forceRefresh) {
      calls.push(['token', forceRefresh]);
      return token;
    },
  };
  const auth = { currentUser: user };
  const sdk = {
    inMemoryPersistence: Symbol('memory-only'),
    browserPopupRedirectResolver: Symbol('popup'),
    initializeApp(config) {
      calls.push(['initializeApp', config]);
      return {};
    },
    initializeAuth(app, options) {
      calls.push(['initializeAuth', options]);
      return auth;
    },
    GoogleAuthProvider: class {
      setCustomParameters(parameters) {
        calls.push(['provider', parameters]);
      }
    },
    async signInWithPopup() {
      calls.push(['popup']);
      auth.currentUser = user;
      return { user };
    },
    async signOut() {
      calls.push(['signOut']);
      auth.currentUser = null;
    },
  };
  return { sdk, calls, token, user, auth };
}

test('helper accepts bounded public staging config and refuses privileged/wrong-project inputs', () => {
  assert.deepEqual(publicConfig(configuration), configuration);
  assert.deepEqual(
    publicConfig({ ...configuration, appId: '' }),
    configuration,
  );
  for (const input of [
    null,
    [],
    { ...configuration, private_key: 'synthetic' },
    { ...configuration, client_secret: 'synthetic' },
    { ...configuration, apiKey: 'x'.repeat(300) },
    { ...configuration, apiKey: 'key with spaces' },
    { ...configuration, projectId: 'blogpost-512905' },
    { ...configuration, authDomain: 'example.invalid' },
    { ...configuration, appId: '\u0000' },
  ])
    assert.throws(() => publicConfig(input));
});

test('Google popup client uses memory-only auth and returns only identity and fresh ID token', async () => {
  const { sdk, calls } = fixture();
  const client = createSignInClient(sdk);
  const value = await client.signIn(configuration);
  assert.deepEqual(Object.keys(value).sort(), [
    'email',
    'expiresAt',
    'token',
    'uid',
  ]);
  assert.equal(value.token, 'synthetic.payload.signature');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['initializeApp', 'initializeAuth', 'provider', 'popup', 'token'],
  );
  assert.equal(calls[1][1].persistence, sdk.inMemoryPersistence);
  assert.equal(
    calls[1][1].popupRedirectResolver,
    sdk.browserPopupRedirectResolver,
  );
  assert.deepEqual(calls[2][1], { prompt: 'select_account' });
  assert.deepEqual(calls.at(-1), ['token', true]);
  await client.refresh();
  assert.deepEqual(calls.at(-1), ['token', true]);
  await client.signOut();
  await assert.rejects(client.refresh(), /Sign in with Google first/);
  await client.signIn(configuration);
  assert.equal(calls.filter(([name]) => name === 'initializeApp').length, 1);
  await assert.rejects(
    client.signIn({ ...configuration, apiKey: 'different-public-key' }),
    /Reload/,
  );
});

test('client rejects wrong audience/provider, unverified or expired credentials and clears failed sign-in', async () => {
  for (const mutate of [
    ({ token }) => {
      token.claims.aud = 'other-project';
    },
    ({ token }) => {
      token.claims.iss = 'https://accounts.google.com';
    },
    ({ token }) => {
      token.claims.firebase.sign_in_provider = 'password';
    },
    ({ token }) => {
      token.claims.firebase.tenant = 'unexpected';
    },
    ({ token }) => {
      token.expirationTime = new Date(Date.now() - 1000).toISOString();
    },
    ({ token }) => {
      token.claims.sub = 'different-user';
    },
    ({ user }) => {
      user.emailVerified = false;
    },
  ]) {
    const state = fixture();
    mutate(state);
    await assert.rejects(createSignInClient(state.sdk).signIn(configuration));
    assert.equal(state.auth.currentUser, null);
    assert.deepEqual(state.calls.at(-1), ['signOut']);
  }
  const state = fixture();
  state.sdk.signInWithPopup = async () => {
    throw {
      code: 'auth/popup-closed-by-user',
      message: 'sensitive identity data',
    };
  };
  await assert.rejects(createSignInClient(state.sdk).signIn(configuration));
  assert.equal(state.auth.currentUser, null);
  assert.doesNotMatch(
    signInMessage({ message: 'sensitive identity data' }),
    /sensitive/,
  );
  assert.match(
    signInMessage({ code: 'auth/popup-closed-by-user' }),
    /cancelled/,
  );
  assert.match(
    signInMessage({ code: 'auth/unauthorized-domain' }),
    /localhost/,
  );
});

test('helper only serves explicit noncached assets on canonical loopback origin', async (t) => {
  const server = await createSignInServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const get = (path, { method = 'GET', headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: { Host: `localhost:${port}`, ...headers },
        },
        (res) => {
          const parts = [];
          res.on('data', (part) => parts.push(part));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(parts).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Google sign-in for Postman/);
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.match(
    home.headers['content-security-policy'],
    /frame-ancestors 'none'/,
  );
  assert.equal(
    home.headers['cross-origin-opener-policy'],
    'same-origin-allow-popups',
  );
  assert.equal(home.headers['access-control-allow-origin'], undefined);
  for (const path of ['/app.js', '/client.mjs', '/style.css'])
    assert.equal((await get(path)).status, 200);
  assert.equal((await get('/', { method: 'HEAD' })).body, '');
  for (const path of [
    '/token',
    '/config',
    '/.env',
    '/../package.json',
    '/?idToken=synthetic',
    'http://example.invalid/',
  ])
    assert.equal((await get(path)).status, 404);
  assert.equal((await get('/', { method: 'POST' })).status, 405);
  for (const headers of [
    { Host: `127.0.0.1:${port}` },
    { Host: `attacker.invalid:${port}` },
    { Origin: 'https://attacker.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])
    assert.equal((await get('/', { headers })).status, 403);
});

test('helper CLI accepts only a valid unprivileged local port', () => {
  assert.equal(parsePort([]), 8045);
  assert.equal(parsePort(['--port', '8046']), 8046);
  for (const args of [
    ['--host', '0.0.0.0'],
    ['--port', '0'],
    ['--port', '65536'],
    ['--port', '8045', '--token', 'synthetic'],
    ['--port', '8045?token=x'],
  ])
    assert.throws(() => parsePort(args));
});
