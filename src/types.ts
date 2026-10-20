import type { PDFDocumentProxy } from "./vendor/pdf.mjs";
export type ColorMode = "smart" | "original" | "invert";
export interface ReadingState {
  page: number;
  zoom: string;
  rotation: number;
  mode: ColorMode;
  single: boolean;
  bookmarks: number[];
  originals: number[];
}
export const defaultReading = (): ReadingState => ({
  page: 1,
  zoom: "page-width",
  rotation: 0,
  mode: "smart",
  single: false,
  bookmarks: [],
  originals: [],
});
export interface DocumentInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  identity: string;
  modified: number;
  draftChanged?: boolean;
}
export interface RecentFile {
  path: string;
  name: string;
  opened: number;
}
export interface Tab {
  info: DocumentInfo;
  state: ReadingState;
}
export interface Group {
  tabs: Tab[];
  active: string | null;
}
export interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
}
export interface MarkupItem {
  id: string;
  page: number;
  text: string;
  comment: string;
  color: string;
  editor?: any;
}
export interface ReaderHandle {
  document: PDFDocumentProxy | null;
  state(): ReadingState;
  flush(): Promise<void>;
  export(): Promise<void>;
  print(): Promise<void>;
  navigate(page: number): void;
  zoom(value: string): void;
  rotate(): void;
  search(query: string, previous?: boolean): void;
  tool(tool: "select" | "highlight" | "comment"): void;
  undo(): void;
  redo(): void;
  refreshColors(): void;
  previewOriginal(active: boolean): void;
  bookmark(): void;
  toggleOriginal(): void;
  editComment(item: MarkupItem): void;
  deleteMarkup(item: MarkupItem): void;
}
