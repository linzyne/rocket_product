export function normalizeDateValue(val: unknown): Date | string {
  if (val instanceof Date) return val;
  if (val === '' || val == null) return '';
  const s = String(val).trim();
  if (/^\d{8}$/.test(s)) {
    const dt = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    return isNaN(dt.getTime()) ? s : dt;
  }
  const tryDate = new Date(s.replace(/\./g, '-').replace(/\//g, '-'));
  if (!isNaN(tryDate.getTime())) return tryDate;
  return s;
}

export function dateKeyYMD(v: Date | string | unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (v === '' || v == null) return '';
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s.replace(/\./g, '-').replace(/\//g, '-'));
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '9999-12-31';
}

export function ymdSortKey(v: Date | string | unknown): number {
  const ymd = dateKeyYMD(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 99991231;
}

export function formatDateDisplay(v: Date | string | unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}. ${v.getMonth() + 1}. ${v.getDate()}`;
  }
  if (v === '' || v == null) return '';
  return String(v);
}
