import type { AnnotationSample, AuditEvent, Mode, Rect, Step } from "../types";
import { RESEARCH_PROTOCOL } from "../protocol";
import { LABEL_SCALE_VERSION, PROCESSING_VERSION } from "../version";

const DATABASE_NAME = "affective-slider-local";
const STORE_NAME = "drafts";
const DRAFT_KEY = "active-session";
const DATABASE_VERSION = 1;

export interface SessionDraft {
  draftVersion: 3;
  processingVersion: string;
  labelScaleVersion: string;
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
  const result = await requestToPromise<StoredDraft | undefined>(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DRAFT_KEY));
  database.close();
  return result ? normalizeDraft(result) : null;
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

type LegacySessionDraftV2 = Omit<SessionDraft, "draftVersion" | "labelScaleVersion"> & {
  draftVersion: 2;
  labelScaleVersion?: never;
};

type LegacySessionDraftV1 = Omit<SessionDraft, "draftVersion" | "processingVersion" | "labelScaleVersion"> & {
  draftVersion: 1;
  processingVersion?: never;
  labelScaleVersion?: never;
};

type StoredDraft = SessionDraft | LegacySessionDraftV2 | LegacySessionDraftV1;

export function normalizeDraft(draft: StoredDraft): SessionDraft {
  if (draft.draftVersion === 3
    && draft.processingVersion === PROCESSING_VERSION
    && draft.labelScaleVersion === LABEL_SCALE_VERSION) return draft;
  if (draft.draftVersion < 3 && draft.processingVersion === PROCESSING_VERSION) {
    const migrateValue = (input: number) => Math.min(1, Math.max(0, (input + 1) / 2));
    return {
      ...draft,
      draftVersion: 3,
      processingVersion: PROCESSING_VERSION,
      labelScaleVersion: LABEL_SCALE_VERSION,
      valence: migrateValue(draft.valence),
      arousal: migrateValue(draft.arousal),
      samples: draft.samples.map((sample) => ({
        ...sample,
        valenceRaw: sample.valenceRaw === null ? null : migrateValue(sample.valenceRaw),
        arousalRaw: sample.arousalRaw === null ? null : migrateValue(sample.arousalRaw),
      })),
      labelTrajectories: {
        valence: draft.labelTrajectories.valence.map((point) => ({ ...point, value: migrateValue(point.value) })),
        arousal: draft.labelTrajectories.arousal.map((point) => ({ ...point, value: migrateValue(point.value) })),
      },
      auditEvents: [
        ...draft.auditEvents,
        {
          event: "label_change",
          mediaTime: draft.clipStart,
          recordedAt: new Date().toISOString(),
          mode: null,
          detail: "draft_label_scale_migrated_minus_one_to_one_to_zero_to_one",
        },
      ],
    };
  }
  if (draft.processingVersion === PROCESSING_VERSION) {
    return {
      ...draft,
      draftVersion: 3,
      labelScaleVersion: LABEL_SCALE_VERSION,
      samples: draft.samples.map((sample) => ({ ...sample, valenceRaw: null, arousalRaw: null })),
      mode: null,
      valence: RESEARCH_PROTOCOL.labelNeutralValue,
      arousal: RESEARCH_PROTOCOL.labelNeutralValue,
      valenceDone: false,
      arousalDone: false,
      currentTime: draft.clipStart,
      labelTrajectories: { valence: [], arousal: [] },
      auditEvents: [
        ...draft.auditEvents,
        {
          event: "label_change",
          mediaTime: draft.clipStart,
          recordedAt: new Date().toISOString(),
          mode: null,
          detail: "draft_label_scale_version_changed_reannotation_required",
        },
      ],
    };
  }
  return {
    ...draft,
    draftVersion: 3,
    processingVersion: PROCESSING_VERSION,
    labelScaleVersion: LABEL_SCALE_VERSION,
    step: "roi",
    samples: [],
    mode: null,
    valence: RESEARCH_PROTOCOL.labelNeutralValue,
    arousal: RESEARCH_PROTOCOL.labelNeutralValue,
    valenceDone: false,
    arousalDone: false,
    currentTime: draft.clipStart,
    labelTrajectories: { valence: [], arousal: [] },
    auditEvents: [
      ...draft.auditEvents,
      {
        event: "seek",
        mediaTime: draft.clipStart,
        recordedAt: new Date().toISOString(),
        mode: null,
        detail: "draft_processing_version_changed_reextract_required",
      },
    ],
  };
}
