import { strToU8, zipSync } from "fflate";
import type { AuditEvent, QaReport, SessionMetadata } from "../types";
import { buildCsv, buildMetadata } from "./csv";
import type { AnnotationSample } from "../types";

export interface ExportBundle {
  blob: Blob;
  filename: string;
  manifest: {
    bundleVersion: string;
    anonymousVideoId: string;
    createdAt: string;
    files: Array<{ name: string; bytes: number; sha256: string }>;
  };
}

export async function buildExportBundle(
  samples: AnnotationSample[],
  metadata: SessionMetadata,
  events: AuditEvent[],
  qa: QaReport,
): Promise<ExportBundle> {
  const metadataJson = buildMetadata(metadata, events, qa);
  const csvName = "dataset.csv";
  const metadataName = "metadata_qa.json";
  const files: Record<string, Uint8Array> = { [metadataName]: strToU8(metadataJson) };
  const fileEntries: Array<{ name: string; bytes: number; sha256: string }> = [
    { name: metadataName, bytes: byteLength(metadataJson), sha256: await sha256(metadataJson) },
  ];
  if (qa.passed) {
    const csv = buildCsv(samples, metadata);
    files[csvName] = strToU8(csv);
    fileEntries.unshift({ name: csvName, bytes: byteLength(csv), sha256: await sha256(csv) });
  }
  const manifest = {
    bundleVersion: "1.0.0",
    anonymousVideoId: metadata.anonymousVideoId,
    createdAt: new Date().toISOString(),
    files: fileEntries,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const archive = zipSync(files, { level: 6 });
  return {
    blob: new Blob([archive.slice().buffer], { type: "application/zip" }),
    filename: `${safeFilename(metadata.anonymousVideoId)}_${qa.passed ? "affective-slider" : "qa-failed"}.zip`,
    manifest,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sha256(content: string) {
  if (!crypto.subtle) throw new Error("此瀏覽器不支援資料完整性檢查，請改用最新版 Safari、Chrome 或 Edge。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function byteLength(content: string) {
  return new TextEncoder().encode(content).byteLength;
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
