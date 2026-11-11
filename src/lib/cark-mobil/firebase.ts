import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";

// Çark Mobil paneli, mobil uygulamanın (Tanker Takip) kullandığı Firebase projesine tarayıcıdan
// doğrudan bağlanır: yönetici mobil hesabıyla giriş yapar, okumalar Firestore/RTDB kurallarıyla,
// tüm yazmalar mobil uygulamanın da çağırdığı `operations` sunucu fonksiyonuyla yapılır. Portal
// sunucusunda (Next.js) bu veriye ait hiçbir şey tutulmaz.
//
// Aşağıdaki web yapılandırması gizli değildir (mobil uygulamadaki firebase_options ile aynı
// türdendir); erişimi Firebase kuralları ve giriş belirler.
const CONFIG = {
  apiKey: "AIzaSyBANNYxOPkNk5YL7Y2BCG093RZsfBPERA0",
  authDomain: "tanker-takip.firebaseapp.com",
  projectId: "tanker-takip",
  databaseURL: "https://tanker-takip-default-rtdb.europe-west1.firebasedatabase.app",
  storageBucket: "tanker-takip.firebasestorage.app",
  messagingSenderId: "456068346031",
  appId: "1:456068346031:web:899e7134e3651ff6aa245a",
};

// Geliştirme: NEXT_PUBLIC_CARK_MOBIL_EMULATOR=1 ile yerel Firebase emülatörüne bağlanır
// (gerçek veriye dokunmadan deneme). Üretim derlemesinde tanımlı değildir. Portlar, aynı
// makinede çalışan başka projelerin emülatörleriyle çakışmasın diye varsayılanlardan farklıdır.
const EMULATOR = process.env.NEXT_PUBLIC_CARK_MOBIL_EMULATOR === "1";
const REGION = "europe-west1";

type Services = { auth: Auth; db: Firestore; rtdb: Database; storage: FirebaseStorage; functions: Functions };
let services: Services | null = null;

export function fb(): Services {
  if (services) return services;
  const app =
    getApps()[0] ??
    initializeApp(
      EMULATOR
        ? {
            ...CONFIG,
            projectId: "demo-tanker-takip",
            databaseURL: "http://127.0.0.1:19000?ns=demo-tanker-takip",
            storageBucket: "demo-tanker-takip.appspot.com",
          }
        : CONFIG
    );
  const s: Services = {
    auth: getAuth(app),
    db: getFirestore(app),
    rtdb: getDatabase(app),
    storage: getStorage(app),
    functions: getFunctions(app, REGION),
  };
  if (EMULATOR) {
    connectAuthEmulator(s.auth, "http://127.0.0.1:19099", { disableWarnings: true });
    connectFirestoreEmulator(s.db, "127.0.0.1", 18080);
    connectDatabaseEmulator(s.rtdb, "127.0.0.1", 19000);
    connectStorageEmulator(s.storage, "127.0.0.1", 19199);
    connectFunctionsEmulator(s.functions, "127.0.0.1", 15001);
  }
  services = s;
  return s;
}

export const isEmulator = EMULATOR;

// Mobil uygulamadaki tek yazma kapısı: operations({ action, payload }).
export async function callOp<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await httpsCallable(fb().functions, "operations")({ action, payload });
  return res.data as T;
}

export async function loginWithPin(username: string, pin: string): Promise<void> {
  const res = await httpsCallable(fb().functions, "driverLogin")({ username: username.trim().toLowerCase(), pin });
  await signInWithCustomToken(fb().auth, (res.data as { token: string }).token);
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(fb().auth, email.trim(), password);
}

// Sunucu ve Firebase hatalarını kullanıcıya gösterilecek Türkçe metne çevirir.
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: unknown };
  const code = String(err?.code ?? "");
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return "E-posta veya şifre hatalı.";
  if (/network-request-failed|unavailable/.test(code)) return "Bağlantı kurulamadı. İnternetinizi kontrol edin.";
  if (/too-many-requests/.test(code)) return "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.";
  if (/permission-denied/.test(code) && !err?.message) return "Bu işlem için yetkiniz yok.";
  if (code === "functions/invalid-argument" && Array.isArray(err.details) && err.details.length) {
    const d = err.details as { path?: (string | number)[]; message?: string }[];
    return `Alanları kontrol edin: ${d.map((i) => `${(i.path ?? []).join(".")} ${i.message ?? ""}`.trim()).join("; ")}`;
  }
  if (code === "functions/internal" && (!err.message || err.message === "internal")) {
    return "İşlem tamamlanamadı. Tekrar deneyin.";
  }
  return err?.message || "İşlem tamamlanamadı.";
}
