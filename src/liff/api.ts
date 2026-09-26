import { getD1 } from '../db/client';
import {
  listTransactionsByMonth,
  getMonthTotals,
  getCategoryTotalsByMonth,
  getMonthlyTrend,
  createManualTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
  getMonthlyBudget,
  setMonthlyBudget,
  saveCategoryRule,
  findCategoryRule,
  monthShift
} from '../db/liff';
import { upsertUser } from '../db/queries';
import { logEvent } from '../db/events';
import { audit } from '../observability/log';

interface LiffUser {
  userId: string;
  name?: string;
}

// Access tokens are verified by LINE once per isolate and cached briefly to
// keep the API fast (LIFF calls several endpoints per screen).
const tokenCache = new Map<string, { user: LiffUser; expires: number }>();
const TOKEN_CACHE_MS = 5 * 60 * 1000;

async function getLiffUser(request: Request): Promise<LiffUser | null> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;

  try {
    const [verifyRes, userinfoRes] = await Promise.all([
      fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`),
      fetch('https://api.line.me/oauth2/v2.1/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);
    if (!verifyRes.ok || !userinfoRes.ok) return null;

    const profile: any = await userinfoRes.json();
    if (!profile?.sub) return null;

    const user: LiffUser = { userId: profile.sub, name: profile.name };
    tokenCache.set(token, { user, expires: Date.now() + TOKEN_CACHE_MS });
    if (tokenCache.size > 500) {
      for (const [k, v] of tokenCache) {
        if (v.expires <= Date.now()) tokenCache.delete(k);
      }
    }
    return user;
  } catch {
    return null;
  }
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Routes under /api/liff/* — all require a valid LINE access token.
 */
export async function handleLiffApi(request: Request, url: URL): Promise<Response> {
  const user = await getLiffUser(request);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getD1();
  const route = url.pathname.replace(/^\/api\/liff\/?/, '').replace(/\/$/, '');
  const method = request.method;

  try {
    if (method === 'GET' && route === 'me') {
      return Response.json({ userId: user.userId, name: user.name ?? null });
    }

    // Save the LIFF display name so the bot's member summary can show it
    if (method === 'POST' && route === 'me') {
      const body = await readJson(request);
      if (body.name) {
        await upsertUser(db, { line_user_id: user.userId, nickname: String(body.name) });
      }
      return Response.json({ ok: true });
    }

    if (method === 'GET' && route === 'dashboard') {
      const raw = url.searchParams.get('month') || '';
      const month = raw === 'all' || /^\d{4}-\d{2}$/.test(raw)
        ? raw
        : monthShift(new Date(), 0);

      const [totals, budget, categories, trend, transactions] = await Promise.all([
        getMonthTotals(db, user.userId, month),
        getMonthlyBudget(db, user.userId),
        getCategoryTotalsByMonth(db, user.userId, month),
        getMonthlyTrend(db, user.userId),
        listTransactionsByMonth(db, user.userId, month)
      ]);

      return Response.json({ month, totals, budget, categories, trend, transactions });
    }

    if (method === 'POST' && route === 'transactions') {
      const body = await readJson(request);
      const amount = Number(body.amount);
      const type = body.type === 'income' ? 'income' : 'expense';
      const category = String(body.category || 'อื่นๆ');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))
        ? String(body.date)
        : new Date().toISOString().split('T')[0];
      if (!Number.isFinite(amount) || amount <= 0) return badRequest('amount must be a positive number');

      await createManualTransaction(db, user.userId, {
        amount,
        type,
        category,
        merchant: body.merchant ? String(body.merchant) : null,
        date
      });
      audit(db, user.userId, 'create', 'transaction', null, { amount, type, category, date });
      return Response.json({ ok: true });
    }

    if (method === 'PUT' && route.startsWith('transactions/')) {
      const id = route.slice('transactions/'.length);
      const body = await readJson(request);
      const fields: any = {};
      if (body.amount !== undefined) fields.amount = Number(body.amount);
      if (body.type !== undefined) fields.type = body.type === 'income' ? 'income' : 'expense';
      if (body.category !== undefined) fields.category = String(body.category);
      if (body.merchant !== undefined) fields.merchant = body.merchant ? String(body.merchant) : null;
      if (body.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) fields.date = String(body.date);

      const ok = await updateTransaction(db, user.userId, id, fields);
      if (ok) audit(db, user.userId, 'update', 'transaction', id, { fields: Object.keys(fields) });
      return Response.json({ ok });
    }

    if (method === 'DELETE' && route.startsWith('transactions/')) {
      const id = route.slice('transactions/'.length);
      await deleteTransaction(db, user.userId, id);
      audit(db, user.userId, 'delete', 'transaction', id);
      return Response.json({ ok: true });
    }

    if (method === 'POST' && route === 'transactions/bulk-delete') {
      const body = await readJson(request);
      const ids = Array.isArray(body.ids)
        ? ([...new Set(body.ids.map((v: unknown) => String(v).trim()).filter(Boolean))] as string[]).slice(0, 200)
        : [];
      if (!ids.length) return badRequest('ids must be a non-empty array');
      const deleted = await deleteTransactions(db, user.userId, ids);
      return Response.json({ ok: true, deleted });
    }

    if (method === 'POST' && route === 'budget') {
      const body = await readJson(request);
      const amount = Number(body.monthly_budget);
      if (!Number.isFinite(amount) || amount < 0) return badRequest('monthly_budget must be a number');
      await setMonthlyBudget(db, user.userId, amount);
      audit(db, user.userId, 'set', 'budget', null, { monthly_budget: amount });
      return Response.json({ ok: true });
    }

    if (method === 'POST' && route === 'suggest-category') {
      const body = await readJson(request);
      const keyword = String(body.keyword || '').trim();
      if (!keyword) return Response.json({ rule: null });
      const rule = await findCategoryRule(db, keyword);
      return Response.json({ rule });
    }

    if (method === 'POST' && route === 'category-rules') {
      const body = await readJson(request);
      const keyword = String(body.keyword || '').trim();
      const category = String(body.category || '').trim();
      if (!keyword || !category) return badRequest('keyword and category are required');
      await saveCategoryRule(db, keyword, category, body.type === 'income' ? 'income' : 'expense');
      audit(db, user.userId, 'set', 'category_rule', null, { keyword, category });
      return Response.json({ ok: true });
    }

    if (method === 'GET' && route === 'export') {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
        ? (url.searchParams.get('month') as string)
        : monthShift(new Date(), 0);
      const rows = await listTransactionsByMonth(db, user.userId, month);
      const header = 'date,type,category,amount,merchant,source';
      const csv = [
        header,
        ...rows.map(r =>
          [r.date, r.type, r.category, r.amount, `"${(r.merchant || '').replace(/"/g, '""')}"`, r.source].join(',')
        )
      ].join('\n');
      return new Response('\uFEFF' + csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="transactions-${month}.csv"`
        }
      });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  } catch (err: any) {
    console.error('[LIFF API] Error:', err);
    logEvent(db, 'error', 'liff', 'api_error', `${method} ${route}: ${String(err?.message || err)}`);
    return Response.json({ error: err?.message || 'internal error' }, { status: 500 });
  }
}
