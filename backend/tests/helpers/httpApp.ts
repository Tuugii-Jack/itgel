import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createApp } from '../../src/app.js';

export function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

export function tokenSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

export async function startApp() {
  return listen(createApp());
}
