import type { AnnotationSample, AuditEvent, Mode, Rect, Step } from "../types";

const DATABASE_NAME = "affective-slider-local";
const STORE_NAME = "drafts";
const DRAFT_KEY = "active-session";
const DATABASE_VERSION = 1;

export interface SessionDraft {
  draftVersion: 1;
  savedAt: string;
  videoFingerprint: string;
  videoDurationSec: number;
  clipStart: number;
  clipEnd: number;
  step: Step;
  roi: Rect | null;
  samples: AnnotationSample[];
  mode: Mode;
  valence: number;
  arousal: number;
  valenceDone: boolean;
  arousalDone: boolean;
  currentTime: number;
  labelTrajectories: Record<"valence" | "arousal", Array<{ mediaTime: number; value: number }>>;
  auditEvents: AuditEvent[];
  form: {
    gender: string;
    participantId: string;
    sequenceNumber: string;
    sessionId: string;
    stimulusId: string;
    trialId: string;
    stimulusEmotion: string;
    experimentalCondition: string;
  };
}

export function fingerprintVideo(file: File) {
  return `${file.size}:${file.lastModified}:${file.type || "video/mp4"}`;
}

export async function saveDraft(draft: SessionDraft) {
  const database = await openDatabase();
  await requestToPromise(database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(draft, DRAFT_KEY));
  database.close();
}

export async function loadDraft(): Promise<SessionDraft | null> {
  const database = await openDatabase();
  const result = await requestToPromise<SessionDraft | undefined>(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DRAFT_KEY));
  database.close();
  return result?.draftVersion === 1 ? result : null;
}

export async function clearDraft() {
  const database = await openDatabase();
  await requestToPromise(database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(DRAFT_KEY));
  database.close();
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("無法開啟本機暫存資料庫"));
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本機暫存失敗"));
  });
}
