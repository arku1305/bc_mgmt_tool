const { digest } = require('./registration');
const CATEGORIES = { income: ['臨打費', '固定預繳', '其他收入'], expense: ['場地費', '球費', '退款', '其他支出'] };
function text(value, label, limit = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error('請填寫有效的' + label);
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('日期不正確');
  return value;
}
function cents(value) {
  if (!['string','number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) > 100000000) throw new Error('金額須為 0 到 100,000,000，最多兩位小數；未填不代表零元');
  return Math.round(Number(value) * 100);
}
function normalizeEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new Error('請保留至少一筆、最多 1000 筆明細');
  return entries.map(e => {
    if (!CATEGORIES[e?.type]?.includes(e.category)) throw new Error('請選擇正確的收支分類');
    return { name: text(e.name, '明細名稱'), type: e.type, category: e.category, amountCents: cents(e.amount), note: typeof e.note === 'string' ? e.note.trim().slice(0,500) : '' };
  });
}
function totals(entries) {
  const result = { incomeCents: 0, expenseCents: 0, balanceCents: 0, categories: {} };
  for (const e of entries) {
    result[e.type === 'income' ? 'incomeCents' : 'expenseCents'] += e.amountCents;
    result.categories[e.category] = (result.categories[e.category] || 0) + e.amountCents;
  }
  result.balanceCents = result.incomeCents - result.expenseCents;
  return result;
}
function view(state) {
  const records = Object.values(state?.records || {}).sort((a,b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  return { revision: digest(state || {}), records, totals: totals(records.filter(r => !r.voidedAt).flatMap(r => r.entries || [])), categories: CATEGORIES };
}
function save(state, body, context) {
  state ||= {};
  if (digest(state) !== body.expectedRevision) throw new Error('帳務已更新，請重新讀取後再操作，尚未覆寫任何帳目');
  const previous = state.records?.[context.id];
  if (context.edit && !previous) throw new Error('找不到帳目');
  if (!context.edit && previous) throw new Error('這場活動已入帳，請開啟既有帳目編輯，不能重複匯入');
  if (previous?.voidedAt) throw new Error('舊版已作廢帳目不能重新編輯入帳');
  if (context.remove) {
    const records = {...state.records};
    delete records[context.id];
    return {...state,records};
  }
  const title = text(body.title, '帳目名稱');
  const aggregate = context.aggregate || !!previous?.members;
  const members = aggregate ? normalizeEntries(body.entries) : null;
  if (members?.some(e => e.type !== 'income')) throw new Error('活動匯入僅能記錄收入');
  const entries = members ? [{name:title,type:'income',category:'臨打費',amountCents:totals(members).incomeCents,note:''}] : normalizeEntries(body.entries);
  const record = { id: context.id, title, date: date(body.date), entries, ...(members ? {members} : {}),
    source: previous?.source || context.source || { kind: 'manual' },
    createdAt: previous?.createdAt || context.now, updatedAt: context.now, confirmedBy: context.uid };
  return { ...state, records: { ...(state.records || {}), [context.id]: record } };
}
module.exports = { CATEGORIES, date, cents, normalizeEntries, totals, view, save };
