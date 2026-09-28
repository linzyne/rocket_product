import { initializeApp, FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence, Firestore } from 'firebase/firestore';

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Firebase 설정이 없는 환경(.env.local 미설정)에서도 앱이 죽지 않도록, 설정이 갖춰졌을 때만
// 초기화한다. 이 값이 false면 상품목록은 이 기기의 localStorage에만 저장된다.
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let firestoreInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  firestoreInstance = getFirestore(app);
  authInstance = getAuth(app);
  // 오프라인에서도 마지막으로 받아온 데이터를 그대로 보여주고, 다시 온라인이 되면 자동으로
  // 동기화한다. 같은 앱을 여러 탭에서 열어두면 탭 하나만 캐시를 가질 수 있어 실패할 수 있는데,
  // 그 경우는 이 기기의 다른 탭이 이미 캐시를 갖고 있다는 뜻이라 무시해도 안전하다.
  enableIndexedDbPersistence(firestoreInstance).catch(() => {});
}

export const db = firestoreInstance;

// Firestore는 서버가 받아줄 때까지 쓰기 약속(Promise)을 지키지 않는다. 인터넷이 잠깐 끊기거나
// 느리면 그 약속이 영영 끝나지 않아, 화면이 "저장하는 중…"에 멈춰 다음 수집으로 넘어가지 못한다.
// 쓴 내용은 이 기기에 쌓였다가 다시 이어지면 저절로 올라가므로, 오래 걸리면 기다리지 않고 넘어간다.
export const waitAtMost = <T,>(work: Promise<T>, ms = 20000): Promise<T | undefined> =>
  Promise.race([work, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);

let signInPromise: Promise<void> | null = null;

// Firestore 보안 규칙이 "로그인된 사용자만 읽기/쓰기 허용"이라, 실제 쓰기 전에 익명으로 한 번
// 로그인해둔다. 사용자에게는 아무 화면도 보이지 않고 조용히 처리된다.
export const ensureSignedIn = (): Promise<void> => {
  if (!authInstance) return Promise.resolve();
  const auth = authInstance;
  if (!signInPromise) {
    signInPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        if (user) {
          unsubscribe();
          resolve();
        }
      });
      signInAnonymously(auth).catch(error => {
        console.error('Firebase 익명 로그인 실패:', error);
        resolve();
      });
    });
  }
  // 로그인도 끝나지 않을 수 있다. 못 해도 쓰기는 기기에 쌓아두고 나중에 올라간다.
  return waitAtMost(signInPromise, 15000).then(() => {});
};
