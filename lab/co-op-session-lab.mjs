// Protocol-independent session lab. NOT an EveJS server or EVE-client proxy.
// Loopback-only by design; never bind this fixture to a VPN/public interface.
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function startLab({ port = 0, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1') throw new Error('Loopback-only test fixture');
  const sessions = new Map();
  const write = (socket, obj) => {
    if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n');
  };
  const server = net.createServer(socket => {
    const id = randomUUID();
    const session = { id, socket, user: null, buffer: '' };
    sessions.set(id, session);
    write(socket, { type: 'hello', id });
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      session.buffer += chunk;
      if (session.buffer.length > 4096) { socket.destroy(); return; }
      let end;
      while ((end = session.buffer.indexOf('\n')) >= 0) {
        const frame = session.buffer.slice(0, end);
        session.buffer = session.buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(frame); }
        catch { write(socket, { type: 'error', code: 'invalid_json' }); continue; }
        if (message?.type === 'join' && typeof message.user === 'string' &&
          /^[a-zA-Z0-9_-]{1,32}$/.test(message.user) && !session.user) {
          if ([...sessions.values()].some(s => s !== session && s.user === message.user)) {
            write(socket, { type: 'error', code: 'duplicate_user' }); continue;
          }
          session.user = message.user;
          write(socket, { type: 'joined', user: session.user });
          continue;
        }
        if (message?.type === 'broadcast' && session.user &&
          typeof message.text === 'string' && message.text.length <= 256) {
          for (const other of sessions.values()) {
            if (other.user) write(other.socket, { type: 'message', from: session.user, text: message.text });
          }
          continue;
        }
        write(socket, { type: 'error', code: 'bad_request' });
      }
    });
    socket.on('close', () => sessions.delete(id));
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return {
    port: server.address().port,
    count: () => sessions.size,
    close: async () => {
      for (const session of sessions.values()) session.socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lab = await startLab({ port: Number(process.env.LAB_PORT || 28000) });
  console.log('Co-op session fixture on 127.0.0.1:' + lab.port + ' (localhost ONLY)');
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => lab.close().then(() => process.exit(0)));
}
