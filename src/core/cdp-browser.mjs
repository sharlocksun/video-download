import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function getJson(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForPage(port, timeoutMs, predicate = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pages = await getJson(port, '/json/list');
      const page = pages.find((item) => item.type === 'page' && predicate?.(item))
        || pages.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      await sleep(500);
    }
    await sleep(500);
  }
  throw new Error('等待浏览器远程调试端口超时');
}

function wsEncodeFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x81;
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, mask, masked]);
}

function tryDecodeWsMessage(buffer) {
  let offset = 0;
  const chunks = [];

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) return null;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) return null;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const masked = Boolean(second & 0x80);
    const maskLength = masked ? 4 : 0;
    const frameStart = offset + headerLength + maskLength;
    const frameEnd = frameStart + length;
    if (frameEnd > buffer.length) return null;

    let payload = buffer.subarray(frameStart, frameEnd);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    if (opcode === 0x8) {
      throw new Error('WebSocket 在收到 CDP 响应前关闭');
    }
    if (opcode === 0x1 || opcode === 0x0) {
      chunks.push(payload);
      if (first & 0x80) {
        return Buffer.concat(chunks).toString('utf8');
      }
    }
    offset = frameEnd;
  }

  return null;
}

async function cdp(wsUrl, method, params = {}, timeoutMs = 30_000) {
  const payload = JSON.stringify({ id: 1, method, params });
  try {
    return await cdpViaRawSocket(wsUrl, payload, method, timeoutMs);
  } catch (error) {
    if (/ECONNRESET|ECONNREFUSED|WebSocket closed/i.test(String(error?.message || error))) {
      await sleep(400);
      return cdpViaRawSocket(wsUrl, payload, method, timeoutMs);
    }
    throw error;
  }
}

async function cdpViaRawSocket(wsUrl, payload, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(wsUrl);
    const socket = createConnection(Number(target.port), target.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`CDP 命令超时：${method}`));
    }, timeoutMs);

    let buffer = Buffer.alloc(0);
    let handshakeDone = false;

    socket.on('connect', () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n',
      ].join('\r\n'));
    });

    socket.on('data', (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshakeDone) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end === -1) return;
          const header = buffer.subarray(0, end).toString('utf8');
          if (!header.includes(' 101 ')) {
            throw new Error('Chrome 拒绝 WebSocket 握手');
          }
          handshakeDone = true;
          buffer = buffer.subarray(end + 4);
          socket.write(wsEncodeFrame(payload));
        }

        const text = tryDecodeWsMessage(buffer);
        if (!text) return;
        const message = JSON.parse(text);
        if (message.id !== 1) return;
        clearTimeout(timer);
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } catch (error) {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function startCdpBrowser(browserPath, options = {}) {
  const port = options.port || await getFreePort();
  const profileDir = options.profileDir;
  if (profileDir) {
    await mkdir(profileDir, { recursive: true });
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (profileDir) {
    args.push(`--user-data-dir=${profileDir}`);
  }
  if (!options.showBrowser) {
    args.push('--headless=new');
  }
  if (Array.isArray(options.extraArgs)) {
    args.push(...options.extraArgs);
  }
  args.push(options.url || 'about:blank');

  const proc = spawn(browserPath, args, {
    detached: Boolean(options.detached),
    stdio: 'ignore',
    windowsHide: !options.showBrowser,
  });

  if (options.waitForPage === false) {
    return { proc, port, page: null, profileDir };
  }

  const page = await waitForPage(port, options.timeoutMs || 30_000, options.pagePredicate);
  return { proc, port, page, profileDir };
}

function cookiesToHeader(cookies, hostname = 'bilibili.com') {
  return (cookies || [])
    .filter((cookie) => {
      const domain = String(cookie.domain || '').replace(/^\./, '');
      return domain === hostname || domain.endsWith(`.${hostname}`) || hostname.endsWith(`.${domain}`);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getAllCookies(page) {
  const result = await cdp(page.webSocketDebuggerUrl, 'Network.getAllCookies');
  return result.cookies || [];
}

async function getCookiesForUrls(page, urls = []) {
  const result = await cdp(page.webSocketDebuggerUrl, 'Network.getCookies', {
    urls: urls.filter(Boolean),
  });
  return result.cookies || [];
}

export { cdp, cookiesToHeader, getAllCookies, getCookiesForUrls, getFreePort, startCdpBrowser, waitForPage };
