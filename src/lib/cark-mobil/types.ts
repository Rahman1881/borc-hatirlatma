// Mobil uygulamanın (Tanker Takip) Firestore/RTDB kayıt biçimleri. Miktarlar tamsayı mililitre,
// yakıt alımı birim fiyatı on binde bir TL (unitPriceTenThousandths) olarak tutulur.

export type Fuel = "diesel" | "gasoline" | "adblue";
export type WorkRole = "driver" | "pump" | "market" | "wash";
export type TripStatus = "assigned" | "active" | "returning" | "completed" | "cancelled";
export type LatLng = { lat: number; lng: number };

// Firestore zaman damgası (Timestamp) ya da epoch ms.
export type Stamp = { toMillis?: () => number; seconds?: number } | number | null | undefined;

export type Phone = { label: string; number: string };

export type AppUser = {
  id: string;
  displayName?: string;
  email?: string;
  username?: string;
  role?: "admin" | WorkRole | string;
  workRoles?: WorkRole[]; // kişinin yapabildiği işler (birden fazla olabilir)
  loginMethod?: "pin" | "email";
  active?: boolean;
};

export type CustomerLocation = { id: string; label: string; address: string; notes: string; lat: number; lng: number };
export type Customer = {
  id: string;
  name: string;
  taxNumber?: string;
  phone?: string;
  phones?: Phone[];
  active?: boolean;
  deleted?: boolean;
  locations?: CustomerLocation[];
};

export type Vehicle = {
  id: string;
  plate: string;
  capacityLiters: number;
  active?: boolean;
  remainingFuelMl?: number | null;
  fuelRevision?: number;
};

export type Stop = {
  id: string;
  customerId: string;
  locationId: string;
  customerName: string;
  phone?: string;
  phones?: Phone[];
  address: string;
  notes: string;
  lat: number;
  lng: number;
  fuel: Fuel;
  plannedMl: number;
};

export type Route = {
  encodedPolyline?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  order?: number[];
};

export type Trip = {
  id: string;
  driverId: string;
  vehicleId: string;
  driverName?: string;
  vehiclePlate?: string;
  date: string;
  status: TripStatus;
  loadedDieselMl?: number;
  loadedGasolineMl?: number;
  loadedAdBlueMl?: number;
  origin?: LatLng;
  destination?: LatLng;
  stops?: Stop[];
  notes?: string;
  optimize?: boolean;
  route?: Route;
  deliveredMl?: number;
  resolvedCount?: number;
  startedAtMs?: number;
  returningAtMs?: number;
  endedAtMs?: number;
  createdAt?: Stamp;
  deleted?: boolean;
};

export type Delivery = {
  id: string;
  stopId: string;
  status: "delivered" | "partial" | "skipped";
  actualMl: number;
  note?: string;
  receiptPaths?: string[];
  missingReceiptReason?: string;
  receiptMissing?: boolean;
  capturedAtMs: number;
  location?: LatLng | null;
  customerName?: string;
  plannedMl?: number;
  fuel?: Fuel;
};

export type Wait = { id: string; reason?: string; startedAtMs: number; endedAtMs?: number; driverName?: string };

export type TripSummary = {
  deliveredByFuelMl: Record<Fuel, number>;
  deliveredMl: number;
  deliveryCount: number;
  missingReceiptCount: number;
  skippedCount: number;
  waitingMs: number;
  waitCount: number;
  distanceMeters: number | null;
  gpsGapCount: number;
  trackTruncated: boolean;
};

export type LivePoint = LatLng & { tripId?: string; capturedAtMs?: number; accuracy?: number; speed?: number };
export type TrackPoint = LatLng & { capturedAtMs: number; accuracy?: number; speed?: number };

export type FuelHistoryEntry = {
  id: string;
  kind: "add" | "remove" | "set";
  beforeMl: number | null;
  afterMl: number | null;
  amountMl: number;
  note?: string;
  actorName?: string;
  createdAt?: Stamp;
};

export type Refuel = {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  driverId?: string;
  driverName?: string;
  odometerKm: number;
  capturedAtMs: number;
  receiptPath: string;
  revision: number;
  ocrState?: "pending" | "processing" | "complete" | "needs_review" | "manual" | string;
  ocrStartedAtMs?: number;
  amountMl: number | null;
  unitPriceTenThousandths: number | null;
  receiptDateTime: string | null;
  receiptNumber: string | null;
  createdAt?: Stamp;
  deleted?: boolean;
};

export type Notice = {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  tripId?: string;
  refuelId?: string;
  shiftId?: string;
  taskId?: string;
  washId?: string;
  read?: boolean;
  createdAt?: Stamp;
};

export type Settings = { depot?: LatLng; depotName?: string };

export type CustomerHistoryRow = {
  id: string;
  tripId: string;
  stopId: string;
  address: string;
  fuel: Fuel | "unknown";
  actualMl: number;
  plannedMl: number | null;
  capturedAtMs: number | null;
  vehiclePlate: string;
  driverName: string;
  note: string;
  receiptPaths: string[];
  receiptMissing: boolean;
};

// --- İstasyon (vardiya, görev, yıkama). Saatler epoch ms; gün hesabı İstanbul saatine göredir. ---

export type StationConfig = {
  center?: LatLng;
  radiusMeters?: number;
  checkInBeforeMinutes?: number;
  checkInAfterMinutes?: number;
  reminderMinutes?: number;
  graceMinutes?: number;
  washCapacity?: number;
};

export type ShiftTemplate = {
  id: string;
  name: string;
  workRole: WorkRole;
  startMinute: number;
  endMinute: number;
  active: boolean;
};

export type Shift = {
  id: string;
  name: string;
  workRole: WorkRole;
  templateId?: string | null;
  startsAtMs: number;
  endsAtMs: number;
  memberIds: string[];
  members?: { id: string; name: string }[];
  notes?: string;
  status: "draft" | "published" | "cancelled";
  revision?: number;
  cancelReason?: string;
  rotationRole?: string;
};

export type Attendance = {
  id: string;
  shiftId: string;
  userId: string;
  userName?: string;
  checkedInAtMs?: number;
  checkedOutAtMs?: number | null;
  distanceMeters?: number;
  correctedBy?: string;
  correctionReason?: string;
};

export type TaskMode = "common" | "personal" | "person";

export type TaskTemplate = {
  id: string;
  title: string;
  instructions?: string;
  mode: TaskMode;
  assigneeId?: string | null;
  photoRequired: boolean;
  dueMinutes?: number | null;
  remindEveryMinutes?: number | null;
  workRole: WorkRole;
  shiftTemplateId?: string | null;
  weekdays?: number[]; // 1 = Pazartesi
  date?: string | null;
  atMinute?: number | null;
  active: boolean;
};

export type StationTask = {
  id: string;
  shiftId: string;
  shiftName?: string;
  workRole: WorkRole;
  planId?: string;
  title: string;
  instructions?: string;
  mode: TaskMode;
  photoRequired?: boolean;
  startsAtMs: number;
  endsAtMs?: number;
  dueAtMs?: number;
  assigneeIds?: string[];
  status: "todo" | "doing" | "completed" | "cancelled";
  claimedBy?: string | null;
  claimedName?: string | null;
  completedName?: string | null;
  completedAtMs?: number | null;
  note?: string;
  photoPaths?: string[];
  returnReason?: string;
  cancelReason?: string;
};

export type WashService = { id: string; name: string; priceCents: number; active: boolean };

export type WashJob = {
  id: string;
  plate: string;
  serviceId: string;
  serviceName?: string;
  queueNumber?: number;
  queueDate?: string;
  status: "waiting" | "washing" | "completed" | "cancelled";
  createdByName?: string;
  washerId?: string;
  washerName?: string;
  note?: string;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  cancelReason?: string;
};

export type WashPayment = {
  id: string;
  priceCents: number;
  listPriceCents?: number;
  discounted?: boolean;
  paymentMethod?: "cash" | "card" | null;
  status: "paid" | "refund_pending" | "refunded";
  refundNote?: string;
  createdAtMs?: number;
};

export type WashKind = "morning" | "evening" | "afternoon";
export type WashHours = { open: number; morningEnd: number; cover: number; eveningStart: number; afternoon: number; close: number };
export type Rotation = {
  role: "market" | "wash";
  active: boolean;
  anchorDate: string;
  generateFrom: string;
  people: string[];
  phases?: Record<string, number>;
  off?: Record<string, number>;
  kinds?: Record<string, WashKind>;
  hours?: WashHours;
  version?: number;
};
