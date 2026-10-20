import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PDFDataRangeTransport } from "./vendor/pdf.mjs";
import type { DocumentInfo, ReadingState, RecentFile } from "./types";
export const desktop = isTauri();
const browserFiles = new Map<string, Uint8Array>();
const key = (id: string, kind: string) => `limbo:${kind}:${id}`;
export async function choosePdfs(): Promise<DocumentInfo[]> {
  if (desktop) {
    const paths = await open({
      multiple: true,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    return paths
      ? Promise.all((Array.isArray(paths) ? paths : [paths]).map(openPath))
      : [];
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.multiple = true;
    input.onchange = async () =>
      resolve(
        await Promise.all(Array.from(input.files || []).map(openBrowserFile)),
      );
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
export async function openBrowserFile(file: File): Promise<DocumentInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const identity = Array.from(new Uint8Array(hash))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  browserFiles.set(identity, bytes);
  return {
    id: identity,
    identity,
    name: file.name,
    size: file.size,
    path: file.name,
    modified: file.lastModified,
  };
}
export const openPath = (path: string): Promise<DocumentInfo> =>
  invoke("open_document", { path });
export class NativeRange extends PDFDataRangeTransport {
  private stopped = false;
  constructor(
    private info: DocumentInfo,
    initial: Uint8Array,
    private fail: (error: Error) => void,
  ) {
    super(info.size, initial, false);
    this.transportReady(null);
  }
  requestDataRange(begin: number, end: number) {
    invoke<ArrayBuffer>("read_document", { id: this.info.id, begin, end })
      .then((bytes) => {
        if (!this.stopped) this.onDataRange(begin, new Uint8Array(bytes));
      })
      .catch((e) => {
        if (!this.stopped) this.fail(new Error(String(e)));
      });
  }
  abort() {
    this.stopped = true;
  }
}
export async function source(info: DocumentInfo, fail: (e: Error) => void) {
  if (!desktop) return { data: browserFiles.get(info.id)!.slice() };
  const initial = new Uint8Array(
    await invoke<ArrayBuffer>("read_document", {
      id: info.id,
      begin: 0,
      end: Math.min(info.size, 65536),
    }),
  );
  return {
    range: new NativeRange(info, initial, fail),
    length: info.size,
    disableAutoFetch: true,
    disableStream: true,
  };
}
export async function readState(
  info: DocumentInfo,
): Promise<ReadingState | null> {
  const text = desktop
    ? await invoke<string | null>("read_record", {
        identity: info.identity,
        kind: "reading",
      })
    : localStorage.getItem(key(info.identity, "reading"));
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
export async function writeState(info: DocumentInfo, state: ReadingState) {
  const value = JSON.stringify(state);
  if (desktop)
    await invoke("write_record", {
      identity: info.identity,
      kind: "reading",
      value,
    });
  else localStorage.setItem(key(info.identity, "reading"), value);
}
export async function readDraft(
  info: DocumentInfo,
): Promise<Uint8Array | null> {
  if (desktop) {
    const bytes = await invoke<ArrayBuffer>("read_draft", { id: info.id });
    return bytes.byteLength ? new Uint8Array(bytes) : null;
  }
  const encoded = localStorage.getItem(key(info.identity, "draft"));
  return encoded
    ? Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    : null;
}
export async function writeDraft(info: DocumentInfo, bytes: Uint8Array) {
  if (desktop)
    await invoke("write_draft", bytes, { headers: { "x-limbo-id": info.id } });
  else {
    let encoded = "";
    for (let i = 0; i < bytes.length; i += 8192)
      encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    localStorage.setItem(key(info.identity, "draft"), btoa(encoded));
  }
}
export async function exportPdf(info: DocumentInfo, bytes: Uint8Array) {
  if (desktop) {
    const path = await save({
      defaultPath: info.name.replace(/\.pdf$/i, "") + " — annotated.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (path)
      await invoke("export_document", {
        id: info.id,
        path,
        bytes: Array.from(bytes),
      });
  } else {
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = info.name.replace(/\.pdf$/i, "") + " — annotated.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
export async function recentFiles(): Promise<RecentFile[]> {
  if (desktop) return invoke("recent_files");
  try {
    return JSON.parse(localStorage.getItem("limbo:recents") || "[]");
  } catch {
    return [];
  }
}
export async function clearRecents() {
  if (desktop) await invoke("clear_recents");
  else localStorage.removeItem("limbo:recents");
}
export async function externalLink(url: string) {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return;
  if (desktop) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
