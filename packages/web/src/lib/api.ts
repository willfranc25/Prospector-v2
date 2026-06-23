const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function request(method: string, path: string, body?: any, params?: Record<string, any>) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    });
  }

  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), options);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || err.message || `Error ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: (path: string, params?: Record<string, any>) => request('GET', path, undefined, params),
  post: (path: string, body?: any) => request('POST', path, body),
  put: (path: string, body?: any) => request('PUT', path, body),
  delete: (path: string) => request('DELETE', path)
};
