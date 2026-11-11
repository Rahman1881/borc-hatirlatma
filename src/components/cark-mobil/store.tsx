"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { onValue, ref } from "firebase/database";
import { fb } from "@/lib/cark-mobil/firebase";
import type { AppUser, Customer, LivePoint, Notice, Settings, Trip, Vehicle } from "@/lib/cark-mobil/types";

// Oturum ve mobil uygulamayla ortak canlı veriler. Yönetici girişinden sonra mobil
// uygulamadaki yönetici ekranının dinlediği koleksiyonlar dinlenir; telefonda yapılan
// değişiklik burada, burada yapılan telefonda anında görünür.

type Phase = "loading" | "signedOut" | "denied" | "ready";

type Store = {
  phase: Phase;
  deniedReason: string;
  me: AppUser | null;
  users: AppUser[];
  vehicles: Vehicle[];
  customers: Customer[];
  activeTrips: Trip[]; // atanmış / yolda / dönüşte
  trips: Trip[]; // en yeni `tripLimit` sefer (geçmiş dahil)
  tripLimit: number;
  loadMoreTrips: () => void;
  settings: Settings;
  notices: Notice[];
  live: Record<string, LivePoint>; // şoför uid -> son konum
  logout: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function useCark(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCark, CarkProvider içinde kullanılmalı.");
  return v;
}

const TRIP_PAGE = 100;

export function CarkProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [deniedReason, setDeniedReason] = useState("");
  const [me, setMe] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeTrips, setActiveTrips] = useState<Trip[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripLimit, setTripLimit] = useState(TRIP_PAGE);
  const [settings, setSettings] = useState<Settings>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const [live, setLive] = useState<Record<string, LivePoint>>({});

  // Oturum: yalnız aktif yönetici hesabı panele girebilir.
  useEffect(() => {
    const { auth, db } = fb();
    return onAuthStateChanged(auth, async (account) => {
      if (!account) {
        // Çıkışta bellekteki veriler de temizlenir (başka hesapla girişte eski kayıt görünmesin).
        setMe(null);
        setUsers([]);
        setVehicles([]);
        setCustomers([]);
        setActiveTrips([]);
        setTrips([]);
        setNotices([]);
        setLive({});
        setPhase((p) => (p === "denied" ? p : "signedOut"));
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", account.uid));
        const profile = { id: account.uid, ...(snap.data() ?? {}) } as AppUser;
        if (!snap.exists() || !profile.active || profile.role !== "admin") {
          setDeniedReason(
            !snap.exists() || !profile.active
              ? "Hesabınız aktif değil."
              : "Bu panel yalnız yöneticiler içindir. Şoför hesaplarıyla giriş yapılamaz."
          );
          await signOut(auth);
          setPhase("denied");
          return;
        }
        setMe(profile);
        setPhase("ready");
      } catch {
        setDeniedReason("Hesap bilgileri okunamadı. Bağlantınızı kontrol edip tekrar deneyin.");
        await signOut(auth).catch(() => {});
        setPhase("denied");
      }
    });
  }, []);

  const uid = phase === "ready" ? me?.id : undefined;

  useEffect(() => {
    if (!uid) return;
    const { db, rtdb } = fb();
    const listen = <T,>(q: Query<DocumentData>, set: (rows: T[]) => void) =>
      onSnapshot(
        q,
        (s) => set(s.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
        (e) => console.error("[cark-mobil] dinleme hatası:", e.message)
      );
    const subs = [
      listen<AppUser>(collection(db, "users"), setUsers),
      listen<Vehicle>(collection(db, "vehicles"), setVehicles),
      listen<Customer>(collection(db, "customers"), (rows) => setCustomers(rows.filter((c) => !c.deleted))),
      listen<Trip>(
        query(collection(db, "trips"), where("status", "in", ["assigned", "active", "returning"])),
        (rows) => setActiveTrips(rows.filter((t) => !t.deleted))
      ),
      listen<Notice>(
        query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), limit(100)),
        setNotices
      ),
      onSnapshot(doc(db, "settings", "company"), (s) => setSettings((s.data() as Settings) ?? {})),
      // Canlı konum yalnız yönetici yetkisi (token claim) olan hesaba açıktır.
      onValue(
        ref(rtdb, "live"),
        (s) => setLive((s.val() as Record<string, LivePoint>) ?? {}),
        () => setLive({})
      ),
    ];
    return () => subs.forEach((off) => off());
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(fb().db, "trips"), orderBy("createdAt", "desc"), limit(tripLimit)),
      (s) => setTrips(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip).filter((t) => !t.deleted)),
      (e) => console.error("[cark-mobil] sefer listesi:", e.message)
    );
  }, [uid, tripLimit]);

  const logout = useCallback(async () => {
    await signOut(fb().auth);
  }, []);
  const loadMoreTrips = useCallback(() => setTripLimit((n) => n + TRIP_PAGE), []);

  const value = useMemo<Store>(
    () => ({
      phase,
      deniedReason,
      me,
      users,
      vehicles,
      customers,
      activeTrips,
      trips,
      tripLimit,
      loadMoreTrips,
      settings,
      notices,
      live,
      logout,
    }),
    [phase, deniedReason, me, users, vehicles, customers, activeTrips, trips, tripLimit, loadMoreTrips, settings, notices, live, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
