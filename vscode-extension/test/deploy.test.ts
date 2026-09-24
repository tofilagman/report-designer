import assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DeployError, publishTemplate, syncLibs, testConnection } from '../src/deploy';

interface Received {
  method: string;
  url: string;
  auth?: string;
  body: string;
}

let server: Server;
let base = '';
let received: Received[] = [];
let status = 200;

before(async () => {
  server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    res.statusCode = status;
    res.end(status === 200 ? '' : 'Requested template doesn\'t exists');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const target = () => ({ name: 'dev', url: base });

test('publish sends the file as multipart field "file" with its name', async () => {
  received = [];
  const dir = mkdtempSync(join(tmpdir(), 'rd-deploy-'));
  const file = join(dir, 'invoice.zrpt');
  writeFileSync(file, 'BSONBYTES');
  await publishTemplate(target(), file);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/template/publish');
  assert.match(received[0].body, /name="file"; filename="invoice.zrpt"/);
  assert.match(received[0].body, /BSONBYTES/);
});

test('sync sends each lib as "files" and adds the fallback Processor.js', async () => {
  received = [];
  const libs = mkdtempSync(join(tmpdir(), 'rd-libs-'));
  writeFileSync(join(libs, 'a.js'), '1');
  writeFileSync(join(libs, 'notes.txt'), 'x');
  const fallback = join(mkdtempSync(join(tmpdir(), 'rd-proc-')), 'Processor.js');
  writeFileSync(fallback, '2');
  const names = await syncLibs(target(), libs, fallback);
  assert.deepEqual(names.sort(), ['Processor.js', 'a.js']);
  assert.equal(received[0].url, '/lib/sync');
  assert.equal(received[0].body.match(/name="files"/g)?.length, 2);
});

test('token_env becomes a bearer header, and a missing variable is an error', async () => {
  received = [];
  process.env.RD_TEST_TOKEN = 'abc';
  await testConnection({ ...target(), tokenEnv: 'RD_TEST_TOKEN' });
  assert.equal(received[0].auth, 'Bearer abc');
  delete process.env.RD_TEST_TOKEN;
  await assert.rejects(testConnection({ ...target(), tokenEnv: 'RD_TEST_TOKEN' }), /RD_TEST_TOKEN .* is not set/);
});

test('server errors include status and body', async () => {
  status = 500;
  try {
    await assert.rejects(testConnection(target()), (err: Error) => {
      assert.ok(err instanceof DeployError);
      assert.match(err.message, /500: Requested template/);
      return true;
    });
  } finally {
    status = 200;
  }
});

test('unreachable server gives a readable error', async () => {
  // Grab a free port, then close it so nothing is listening there.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  await assert.rejects(testConnection({ name: 'gone', url: `http://127.0.0.1:${port}` }), /Could not reach gone .*ECONNREFUSED/);
});
