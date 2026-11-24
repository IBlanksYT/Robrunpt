// Arranca um servidor Netlify Blobs local (apenas para testes / pré-visualização local).
import { BlobsServer } from '@netlify/blobs/server';
import { setEnvironmentContext } from '@netlify/blobs';
import { mkdir } from 'node:fs/promises';

export async function startLocalBlobs(directory) {
  await mkdir(directory, { recursive: true });
  const token = 'local-dev-token';
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: 'local-site', token, edgeURL: url, uncachedEdgeURL: url });
  return { server, port };
}
