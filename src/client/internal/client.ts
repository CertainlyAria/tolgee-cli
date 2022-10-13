import type { Response } from 'undici';
import type { Blob } from 'buffer';

import { join } from 'path';
import { readFile } from 'fs/promises';
import { fetch } from 'undici';

import FormData from 'form-data';
import { HttpError } from '../errors';
import { debug } from '../../utils/logger';

type ClientParams =
  | { apiUrl: string | URL; apiKey: `tgpat_${string}`; projectId: number }
  | { apiUrl: string | URL; apiKey: string; projectId?: number };

type Primitive = string | boolean | number;

// I'd love to strictly type the path & stuff...
// But it's a pain to do so with the generated schema unless request code is written in a super specific way.
// Considering this is internal, it's not that big of a deal. ¯\_(ツ)_/¯
type RequestData = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
  query?: Record<string, Primitive | Primitive[] | undefined>;
  headers?: Record<string, string>;
};

let version = '0.0.0';
const packageJson = join(__dirname, '..', '..', '..', 'package.json');
readFile(packageJson, 'utf8').then(
  (pkg) => (version = JSON.parse(pkg).version)
);

export async function request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body?: string | Buffer
) {
  debug(`[HTTP] Requesting: ${method} ${url.href}`);

  headers[
    'user-agent'
  ] = `Tolgee-CLI/${version} (+https://github.com/tolgee/tolgee-cli)`;
  const res = await fetch(url, {
    method: method,
    headers: headers,
    body: body,
  });

  debug(`[HTTP] ${method} ${url.href} -> ${res.status} ${res.statusText}`);
  if (!res.ok) throw new HttpError(res);
  return res;
}

export default abstract class Client {
  constructor(private params: ClientParams) {}

  protected get projectUrl() {
    return 'projectId' in this.params && this.params.projectId !== -1
      ? `/v2/projects/${this.params.projectId}`
      : '/v2/projects';
  }

  /**
   * Performs an HTTP request to the API
   *
   * @param req Request data
   * @returns The response
   */
  protected async request(req: RequestData): Promise<Response> {
    const url = new URL(req.path, this.params.apiUrl);

    if (req.query) {
      for (const param in req.query) {
        if (param in req.query) {
          const val = req.query[param];
          if (val !== undefined) {
            if (Array.isArray(val)) {
              for (const v of val) {
                url.searchParams.append(param, String(v));
              }
            } else {
              url.searchParams.set(param, String(val));
            }
          }
        }
      }
    }

    const headers: Record<string, string> = {
      ...(req.headers || {}),
      'x-api-key': this.params.apiKey,
    };

    let body = undefined;

    if (req.body) {
      if (req.body instanceof FormData) {
        const header = `multipart/form-data; boundary=${req.body.getBoundary()}`;
        headers['content-type'] = header;
        body = req.body.getBuffer();
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(req.body);
      }
    }

    return request(url, req.method, headers, body);
  }

  /**
   * Performs an HTTP request to the API and returns the result as a JSON object
   *
   * @param req Request data
   * @returns The response data
   */
  protected async requestJson<T = unknown>(req: RequestData): Promise<T> {
    return <Promise<T>>this.request(req).then((r) => r.json());
  }

  /**
   * Performs an HTTP request to the API and returns the result as a Blob
   *
   * @param req Request data
   * @returns The response blob
   */
  protected async requestBlob(req: RequestData): Promise<Blob> {
    return this.request(req).then((r) => r.blob());
  }

  /**
   * Performs an HTTP request to the API and forces the consumption of the body, according to recommendations by Undici
   *
   * @see https://github.com/nodejs/undici#garbage-collection
   * @param req Request data
   */
  protected async requestVoid(req: RequestData): Promise<void> {
    const res = await this.request(req);
    if (res.body) {
      for await (const _chunk of res.body);
    }
  }
}
