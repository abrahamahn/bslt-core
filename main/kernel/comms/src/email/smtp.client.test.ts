// main/kernel/comms/src/email/smtp.client.test.ts
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { SmtpClient } from './smtp.client';

interface MockSmtpSession {
  readonly server: Server;
  readonly port: number;
  readonly commands: string[];
  readonly receivedData: string[];
  close: () => Promise<void>;
}

async function startMockSmtpServer(options: {
  readonly greeting?: string;
  readonly ehloResponse?: string;
  readonly authResponses?: readonly string[];
  readonly mailFromResponse?: string;
  readonly rcptToResponse?: string;
  readonly dataResponse?: string;
  readonly endDataResponse?: string;
  readonly closeOnConnect?: boolean;
  readonly hangOnConnect?: boolean;
}): Promise<MockSmtpSession> {
  const commands: string[] = [];
  const receivedData: string[] = [];
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });

    if (options.hangOnConnect === true) {
      return;
    }
    if (options.closeOnConnect === true) {
      socket.destroy();
      return;
    }

    socket.write(`${options.greeting ?? '220 mock.smtp ESMTP ready'}\r\n`);

    let inData = false;
    let dataBuffer = '';
    let lineBuffer = '';
    let authStep = 0;

    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        dataBuffer += text;
        const endIdx = dataBuffer.indexOf('\r\n.\r\n');
        if (endIdx >= 0) {
          receivedData.push(dataBuffer.slice(0, endIdx));
          dataBuffer = '';
          inData = false;
          socket.write(`${options.endDataResponse ?? '250 2.0.0 OK queued'}\r\n`);
        }
        return;
      }

      lineBuffer += text;
      const lines = lineBuffer.split('\r\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        commands.push(line);
        if (line.startsWith('EHLO')) {
          socket.write(`${options.ehloResponse ?? '250-mock.smtp\r\n250 AUTH LOGIN'}\r\n`);
        } else if (line === 'AUTH LOGIN') {
          const resp = options.authResponses?.[authStep] ?? '334 VXNlcm5hbWU6';
          authStep++;
          socket.write(`${resp}\r\n`);
        } else if (authStep > 0 && authStep < 3) {
          const fallback =
            authStep === 1 ? '334 UGFzc3dvcmQ6' : '235 2.7.0 Authentication successful';
          const resp = options.authResponses?.[authStep] ?? fallback;
          authStep++;
          socket.write(`${resp}\r\n`);
        } else if (line.startsWith('MAIL FROM:')) {
          socket.write(`${options.mailFromResponse ?? '250 2.1.0 OK'}\r\n`);
        } else if (line.startsWith('RCPT TO:')) {
          socket.write(`${options.rcptToResponse ?? '250 2.1.5 OK'}\r\n`);
        } else if (line === 'DATA') {
          const resp = options.dataResponse ?? '354 End data with <CR><LF>.<CR><LF>';
          if (resp.startsWith('354')) {
            inData = true;
          }
          socket.write(`${resp}\r\n`);
        } else if (line === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('500 Unknown command\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    port: address.port,
    commands,
    receivedData,
    close: async () => {
      for (const s of sockets) {
        s.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

describe('SmtpClient', () => {
  const activeServers: MockSmtpSession[] = [];

  afterEach(async () => {
    while (activeServers.length > 0) {
      const session = activeServers.pop();
      if (session !== undefined) {
        await session.close();
      }
    }
  });

  it('verifies SMTP server greeting and sends QUIT cleanly', async () => {
    const smtp = await startMockSmtpServer({});
    activeServers.push(smtp);

    const client = new SmtpClient({
      host: '127.0.0.1',
      port: smtp.port,
      secure: false,
      connectionTimeout: 1000,
      socketTimeout: 1000,
    });

    await expect(client.verify()).resolves.toBeUndefined();
    expect(smtp.commands).toEqual(['QUIT']);
  });

  it('rejects verify when greeting is unexpected, connection drops, or connection times out', async () => {
    const badGreeting = await startMockSmtpServer({ greeting: '554 Service unavailable' });
    activeServers.push(badGreeting);
    const client1 = new SmtpClient({
      host: '127.0.0.1',
      port: badGreeting.port,
      secure: false,
      connectionTimeout: 500,
    });
    await expect(client1.verify()).rejects.toThrow('Unexpected greeting: 554 Service unavailable');

    const dropped = await startMockSmtpServer({ closeOnConnect: true });
    activeServers.push(dropped);
    const client2 = new SmtpClient({
      host: '127.0.0.1',
      port: dropped.port,
      secure: false,
      connectionTimeout: 500,
    });
    await expect(client2.verify()).rejects.toThrow('Connection closed while reading response');

    const hanging = await startMockSmtpServer({ hangOnConnect: true });
    activeServers.push(hanging);
    const client3 = new SmtpClient({
      host: '127.0.0.1',
      port: hanging.port,
      secure: false,
      connectionTimeout: 1000,
      socketTimeout: 60,
    });
    await expect(client3.verify()).rejects.toThrow('Socket timeout');
  });

  it('authenticates with AUTH LOGIN, encodes multipart/headers/UTF-8 subject, and dot-stuffs lines', async () => {
    const smtp = await startMockSmtpServer({});
    activeServers.push(smtp);

    const client = new SmtpClient({
      host: '127.0.0.1',
      port: smtp.port,
      secure: false,
      auth: { user: 'mailer', pass: 's3cr3t' },
    });

    const result = await client.send({
      from: '"BSLT App" <noreply@example.com>',
      to: ['Alice <alice@example.com>', 'bob@example.com'],
      subject: '안녕하세요 BSLT',
      text: 'Plain body\r\n.leading dot line',
      html: '<p>Hello = world</p>',
      headers: { 'List-Unsubscribe': '<mailto:unsub@example.com>' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^<\d+\.[a-zA-Z0-9_-]+@127\.0\.0\.1>$/);
    expect(smtp.commands).toContain('AUTH LOGIN');
    expect(smtp.commands).toContain(Buffer.from('mailer').toString('base64'));
    expect(smtp.commands).toContain(Buffer.from('s3cr3t').toString('base64'));
    expect(smtp.commands).toContain('MAIL FROM:<noreply@example.com>');
    expect(smtp.commands).toContain('RCPT TO:<alice@example.com>');
    expect(smtp.commands).toContain('RCPT TO:<bob@example.com>');

    const rawBody = smtp.receivedData[0] ?? '';
    expect(rawBody).toContain('Subject: =?utf-8?B?');
    expect(rawBody).toContain('List-Unsubscribe: <mailto:unsub@example.com>');
    expect(rawBody).toContain('Content-Type: multipart/alternative;');
    expect(rawBody).toContain('..leading dot line');
    expect(rawBody).toContain('<p>Hello =3D world</p>');
  });

  it('fails immediately on permanent 5xx protocol and authentication errors without retrying', async () => {
    const noAuthServer = await startMockSmtpServer({ ehloResponse: '250 mock.smtp' });
    activeServers.push(noAuthServer);
    const noAuthClient = new SmtpClient({
      host: '127.0.0.1',
      port: noAuthServer.port,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(
      await noAuthClient.send({
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Test',
        text: 'Hi',
      }),
    ).toEqual({
      success: false,
      error: 'Server does not support authentication',
    });

    const badPassServer = await startMockSmtpServer({
      authResponses: ['334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '535 5.7.8 Bad credentials'],
    });
    activeServers.push(badPassServer);
    const badPassClient = new SmtpClient({
      host: '127.0.0.1',
      port: badPassServer.port,
      secure: false,
      auth: { user: 'u', pass: 'wrong' },
    });
    expect(
      await badPassClient.send({
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Test',
        html: '<p>HTML only</p>',
      }),
    ).toEqual({
      success: false,
      error: 'AUTH password failed: 535 5.7.8 Bad credentials',
    });

    const badRcptServer = await startMockSmtpServer({
      rcptToResponse: '550 5.1.1 User unknown',
    });
    activeServers.push(badRcptServer);
    const badRcptClient = new SmtpClient({
      host: '127.0.0.1',
      port: badRcptServer.port,
      secure: false,
    });
    expect(
      await badRcptClient.send({
        from: 'a@example.com',
        to: 'missing@example.com',
        subject: 'ASCII Subject',
        text: 'Body',
      }),
    ).toEqual({
      success: false,
      error: 'RCPT TO failed for missing@example.com: 550 5.1.1 User unknown',
    });
  });
});
