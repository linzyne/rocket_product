// 카톡 "나에게 보내기"로 발송대기 마감 알림을 보낸다(Vercel 서버 함수). 주소마다 하는 일:
//   /api/kakao/login     카카오 로그인 화면으로 보낸다(처음 한 번 "카톡 연결").
//   /api/kakao/callback  카카오가 돌려준 코드로 토큰을 받아 저장하고, 연결됐다는 카톡을 보낸다.
//   /api/kakao/alert     클라우드의 발주 데이터를 읽어 마감 임박 발주가 있으면 카톡을 보낸다.
//                        Vercel Cron이 매일 오전 9시·오후 3시(한국)에 부른다. ?test=1 이면 없어도 "없음"을 보낸다.
//
// 필요한 Vercel 환경변수
//   KAKAO_REST_API_KEY      카카오 디벨로퍼스 앱의 REST API 키
//   KAKAO_CLIENT_SECRET     (선택) 앱에서 Client Secret을 켰을 때만
//   KV_REST_API_URL / KV_REST_API_TOKEN  (또는 UPSTASH_REDIS_REST_URL / _TOKEN) 토큰 보관용 Upstash Redis
//   CRON_SECRET             (선택) 있으면 정해진 알림(cron)은 이 값이 맞을 때만 보낸다
//   FIREBASE_*              앱과 같은 Firebase 설정(이미 있음)
//
// 마감 계산은 앱의 useShipDeadline과 같은 기준이다(입고예정일 하루 전까지 발송대기·발송완료에 있어야 함, 이틀 전부터 알림).
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

const APP_URL = 'https://rocket-product.vercel.app';
const REDIRECT = `${APP_URL}/api/kakao/callback`;
const env = (k: string) => (process.env[k] || '').trim();

// ── 토큰 보관(Upstash Redis REST) ──
const kvUrl = () => env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
const kvToken = () => env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
const needKv = () => { if (!kvUrl() || !kvToken()) throw new Error('토큰 보관함(Upstash Redis)이 아직 Vercel에 연결되지 않았어요.'); };
const kvGet = async (key: string): Promise<string | null> => {
  needKv();
  const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${kvToken()}` } });
  const j = await r.json() as { result?: string | null };
  return j.result ?? null;
};
const kvSet = async (key: string, value: string) => {
  needKv();
  await fetch(`${kvUrl()}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken()}` }, body: value });
};

// ── 카카오 ──
const tokenRequest = async (params: Record<string, string>) => {
  const body = new URLSearchParams({ client_id: env('KAKAO_REST_API_KEY'), ...params });
  if (env('KAKAO_CLIENT_SECRET')) body.set('client_secret', env('KAKAO_CLIENT_SECRET'));
  const r = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body,
  });
  const j = await r.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`카카오 토큰 실패: ${j.error || r.status} ${j.error_description || ''}`);
  return j;
};
// 저장된 refresh token으로 access token을 새로 받는다. 카카오가 새 refresh token을 주면(만료 한 달 전부터) 바꿔 저장한다.
const accessToken = async () => {
  const refresh = await kvGet('kakao:refresh');
  if (!refresh) throw new Error('카톡이 아직 연결되지 않았어요. 앱에서 "카톡 연결"을 먼저 눌러 주세요.');
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
  if (j.refresh_token) await kvSet('kakao:refresh', j.refresh_token);
  return j.access_token!;
};
const sendMemo = async (token: string, text: string) => {
  const template = { object_type: 'text', text: text.slice(0, 199), link: { web_url: `${APP_URL}/#/coupang-flow`, mobile_web_url: `${APP_URL}/#/coupang-flow` }, button_title: '발주 진행 열기' };
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const j = await r.json() as { result_code?: number; msg?: string };
  if (j.result_code !== 0) throw new Error(`카톡 보내기 실패: ${j.msg || r.status}`);
};

// ── 발주 데이터 읽기(앱과 같은 Firebase, 익명 로그인) ──
type Doc = Record<string, any>;
export const readData = async () => {
  const config = {
    apiKey: env('FIREBASE_API_KEY'), authDomain: env('FIREBASE_AUTH_DOMAIN'), projectId: env('FIREBASE_PROJECT_ID'),
    storageBucket: env('FIREBASE_STORAGE_BUCKET'), messagingSenderId: env('FIREBASE_MESSAGING_SENDER_ID'), appId: env('FIREBASE_APP_ID'),
  };
  const app = getApps()[0] || initializeApp(config);
  await signInAnonymously(getAuth(app));
  const db = getFirestore(app);
  const all = async (name: string) => (await getDocs(collection(db, name))).docs.map(d => ({ ...d.data(), id: d.id }) as Doc);
  const [lines, shipOuts, batches] = await Promise.all([all('coupangLines'), all('coupangShipOuts'), all('shipmentBatches')]);
  return { lines, shipOuts, batches };
};

// ── 마감 계산(앱 useShipDeadline·shipOutStore와 같은 기준) ──
const UPLOAD_RULE_FROM = Date.parse('2026-10-09T00:00:00+09:00');
const s = (v: unknown) => String(v ?? '').trim();
const boxesOf = (b: Doc) => (b.centers || []).flatMap((c: Doc) => (c.boxes || []) as Doc[]) as Doc[];
const dayNum = (v: string) => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s(v));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
};
const kstToday = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
};
interface Due { no: string; center: string; due: string; daysLeft: number; where: string }
export const computeDeadlines = ({ lines, shipOuts, batches }: { lines: Doc[]; shipOuts: Doc[]; batches: Doc[] }): Due[] => {
  const live = lines.filter(l => l.place !== 'trash');
  const shipLines = (id: string) => live.filter(l => l.place === 'ship' && l.shipOutId === id);
  const uploaded = (item: Doc, its: Doc[]) => {
    if (item.uploadedAt) return true;
    const orders = Array.from(new Set(its.map(l => s(l.발주번호)).filter(Boolean)));
    if (orders.length && orders.every(no => !!(item.shipmentNos || {})[no])) return true;
    return !!item.formSavedAt && item.formSavedAt < UPLOAD_RULE_FROM;
  };
  const batchOf = (item: Doc, its: Doc[]) => {
    const own = batches.find(b => b.id === item.batchId);
    if (own) return own;
    const mine = new Set(its.map(l => s(l.발주번호)));
    const cands = batches.filter(b => boxesOf(b).some(box => (box.lines || []).some((l: Doc) => mine.has(s(l.발주번호)))));
    return cands.length === 1 ? cands[0] : undefined;
  };
  const pending = new Map<string, { center: string; due: string; where: string }>();
  const note = (no: string, center: string, due: string, where: string) => { if (no && due && !pending.has(no)) pending.set(no, { center, due, where }); };
  for (const l of live) {
    if (l.place === 'work') note(s(l.발주번호), s(l.물류센터), s(l.입고예정일), '발주확정');
    else if (l.place === 'reserve') note(s(l.발주번호), s(l.물류센터), s(l.입고예정일), s(l.메모).includes('대기') ? '대기' : '예약');
  }
  for (const item of shipOuts) {
    const its = shipLines(item.id);
    let st: 'sent' | 'waiting' | 'ship' = 'ship';
    if (item.sentDate) st = 'sent';
    else if (item.doneAt) st = 'waiting';
    else if (!item.undoneAt) {
      const b = batchOf(item, its);
      const boxes = b ? boxesOf(b) : [];
      if (boxes.length > 0 && boxes.every(x => s(x.waybill)) && uploaded(item, its)) st = 'waiting';
    }
    for (const l of its) {
      const no = s(l.발주번호);
      const inWaiting = st === 'sent' || (st === 'waiting' && ((item.printedOrders || []).includes(no) || !!item.doneAt));
      if (!inWaiting) note(no, s(item.center), s(item.date), '쉽먼트');
    }
  }
  const today = kstToday();
  const out: Due[] = [];
  pending.forEach((v, no) => {
    const dueN = dayNum(v.due);
    if (!Number.isFinite(dueN)) return;
    const daysLeft = dueN - 1 - today;
    if (daysLeft > 1 || dueN < today - 3) return;
    out.push({ no, center: v.center, due: v.due, daysLeft, where: v.where });
  });
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.due.localeCompare(b.due));
};

const messageOf = (list: Due[]) => {
  const over = list.filter(d => d.daysLeft < 0).length;
  const today = list.filter(d => d.daysLeft === 0).length;
  const tomorrow = list.filter(d => d.daysLeft === 1).length;
  const head = [over && `⛔마감지남 ${over}`, today && `🔴오늘까지 ${today}`, tomorrow && `🟠내일까지 ${tomorrow}`].filter(Boolean).join(' · ');
  const rows = list.map(d => `${d.no} ${d.center} 입고${d.due.slice(5).replace('-', '/')} (${d.where})`);
  return `[로켓] 발송대기 마감 알림\n${head}\n${rows.join('\n')}`;
};

// ── 주소별 처리 ──
export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || '');
  try {
    if (action === 'login') {
      if (!env('KAKAO_REST_API_KEY')) {
        res.writeHead(302, { Location: `${APP_URL}/?kakao=${encodeURIComponent('Vercel에 KAKAO_REST_API_KEY가 아직 없어요.')}#/coupang-flow` });
        return res.end();
      }
      const url = `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(env('KAKAO_REST_API_KEY'))}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=talk_message`;
      res.writeHead(302, { Location: url });
      return res.end();
    }
    if (action === 'callback') {
      const code = String(req.query?.code || '');
      if (!code) throw new Error(String(req.query?.error_description || '카카오가 코드를 주지 않았어요.'));
      const j = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: REDIRECT, code });
      await kvSet('kakao:refresh', j.refresh_token!);
      await sendMemo(j.access_token!, '[로켓] 카톡 알림이 연결됐어요. 발송대기 마감이 다가온 발주가 있으면 매일 오전 9시·오후 3시에 알려 드려요.');
      res.writeHead(302, { Location: `${APP_URL}/?kakao=ok#/coupang-flow` });
      return res.end();
    }
    if (action === 'alert') {
      const test = String(req.query?.test || '') === '1';
      if (test) {
        // 앱의 "카톡 테스트" 버튼. 1분에 한 번만.
        const last = Number(await kvGet('kakao:lastTest') || 0);
        if (Date.now() - last < 60 * 1000) return res.status(429).json({ ok: false, error: '1분 뒤에 다시 눌러 주세요.' });
        await kvSet('kakao:lastTest', String(Date.now()));
      } else if (env('CRON_SECRET') && req.headers?.authorization !== `Bearer ${env('CRON_SECRET')}`) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
      const list = computeDeadlines(await readData());
      if (!list.length && !test) return res.status(200).json({ ok: true, sent: false, count: 0 });
      const token = await accessToken();
      await sendMemo(token, list.length ? messageOf(list) : '[로켓] 카톡 알림 테스트 — 지금 발송대기 마감이 다가온 발주는 없어요.');
      return res.status(200).json({ ok: true, sent: true, count: list.length });
    }
    return res.status(404).json({ ok: false, error: 'unknown action' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (action === 'callback') {
      res.writeHead(302, { Location: `${APP_URL}/?kakao=${encodeURIComponent(msg)}#/coupang-flow` });
      return res.end();
    }
    return res.status(500).json({ ok: false, error: msg });
  }
}
