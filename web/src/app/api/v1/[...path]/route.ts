import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  const publicOrigin = process.env.PUBLIC_ORIGIN || request.nextUrl.origin;
  const allowedOrigins = publicOrigin === 'http://localhost:3000' ? [publicOrigin, 'http://127.0.0.1:3000'] : [publicOrigin];
  if (unsafe && (fetchSite === 'cross-site' || fetchSite === 'same-site' ||
      (origin ? !allowedOrigins.includes(origin) : fetchSite !== 'same-origin'))) {
    return NextResponse.json({ code: 'forbidden_origin', message: 'Запрос из другого источника запрещён.' }, { status: 403 });
  }
  const base = process.env.API_INTERNAL_URL || 'http://localhost:4000';
  const target = new URL(`/api/v1/${path.join('/')}${request.nextUrl.search}`, base);
  const headers = new Headers();
  for (const name of ['content-type', 'cookie', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (unsafe && origin) headers.set('origin', origin);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
    });
    const outbound = new NextResponse(response.body, { status: response.status });
    for (const name of ['content-type', 'cache-control']) {
      const value = response.headers.get(name);
      if (value) outbound.headers.set(name, value);
    }
    // Forward session cookies without exposing them to browser JavaScript.
    for (const cookie of response.headers.getSetCookie()) outbound.headers.append('set-cookie', cookie);
    return outbound;
  } catch {
    return NextResponse.json({ code: 'api_unavailable', message: 'Сервис временно недоступен. Попробуйте позже.' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
