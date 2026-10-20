import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as pdfjs from "./vendor/pdf.mjs";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
  ScrollMode,
} from "./vendor/pdf_viewer.mjs";
import type { AnnotationEditorUIManager } from "pdfjs-dist/types/src/display/editor/tools";
import "pdfjs-dist/web/pdf_viewer.css";
import { classifyPage, type Classification } from "./colors";
import {
  exportPdf,
  externalLink,
  readDraft,
  source,
  writeDraft,
  writeState,
} from "./platform";
import type {
  MarkupItem,
  OutlineItem,
  ReaderHandle,
  ReadingState,
  Tab,
} from "./types";
import { Icon, ToolButton } from "./Icon";
import {
  destinationKey,
  resolveChapterPages,
  type ChapterPage,
} from "./outline";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";
type Ask = (
  title: string,
  initial?: string,
  multiline?: boolean,
) => Promise<string | null>;
interface Props {
  tab: Tab;
  onState: (state: ReadingState) => void;
  ask: Ask;
  onError: (error: unknown) => void;
  onSplit: () => void;
  onReady: () => void;
}
export const Reader = forwardRef<ReaderHandle, Props>(function Reader(
  { tab, onState, ask, onError, onSplit, onReady },
  ref,
) {
  const container = useRef<HTMLDivElement>(null),
    pages = useRef<HTMLDivElement>(null);
  const engine = useRef<{
    viewer: PDFViewer;
    bus: EventBus;
    doc: pdfjs.PDFDocumentProxy;
    ui: AnnotationEditorUIManager | null;
  } | null>(null);
  const state = useRef<ReadingState>({ ...tab.state });
  const [reading, setReading] = useState(state.current);
  const [status, setStatus] = useState("Opening document…"),
    [saveStatus, setSaveStatus] = useState("");
  const [count, setCount] = useState(0),
    [sidebar, setSidebar] = useState(false),
    [sideTab, setSideTab] = useState("chapters");
  const [outline, setOutline] = useState<OutlineItem[]>([]),
    [markup, setMarkup] = useState<MarkupItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState("");
  const [tool, setTool] = useState("select"),
    [preview, setPreview] = useState(false),
    [more, setMore] = useState(false);
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState("");
  const classes = useRef(new Map<number, Classification>()),
    classTasks = useRef(new Map<number, Promise<Classification>>());
  const storedMarkup = useRef<MarkupItem[]>([]);
  const chapterPages = useRef(new Map<string, ChapterPage>());
  const [, updateChapters] = useState(0);
  const interaction = useRef({ pointer: false, last: 0 });
  const saving = useRef<Promise<void> | null>(null),
    savedReading = useRef<string>(""),
    savedHash = useRef<string | null>(null),
    alive = useRef(true),
    previewRef = useRef(false);
  const update = (patch: Partial<ReadingState>) => {
    state.current = { ...state.current, ...patch };
    setReading(state.current);
    onState(state.current);
  };
  const currentMarkup = (): MarkupItem[] => {
    const ui = engine.current?.ui;
    if (!ui) return [];
    const items: MarkupItem[] = [],
      converted = new Set<string>();
    for (const editor of (ui as any).limboEditors()) {
      if (editor.annotationElementId) converted.add(editor.annotationElementId);
      if (editor.isEmpty?.() || editor.deleted) continue;
      items.push({
        id: editor.id,
        page: editor.pageIndex + 1,
        text: editor.content || editor.getText?.() || "Highlighted passage",
        comment: editor.comment?.text || "",
        color: editor.color || "#bca2f5",
        editor,
      });
    }
    for (const [, value] of (engine.current?.doc.annotationStorage as any) ||
      []) {
      const serialized = value.serialize?.() || value;
      if (serialized.deleted && serialized.id) converted.add(serialized.id);
    }
    return [
      ...storedMarkup.current.filter((item) => !converted.has(item.id)),
      ...items,
    ].sort((a, b) => a.page - b.page);
  };
  const flush = async (commit = true) => {
    if (saving.current) await saving.current;
    const e = engine.current;
    if (!e) return;
    if (commit) e.ui?.endCurrentEditing();
    const hash = e.doc.annotationStorage.serializable.hash;
    const job = (async () => {
      const readingJson = JSON.stringify(state.current);
      if (readingJson !== savedReading.current) {
        await writeState(tab.info, state.current);
        savedReading.current = readingJson;
      }
      if (hash === savedHash.current) return;
      if (alive.current) setSaveStatus("Saving…");
      const bytes = await e.doc.saveDocument();
      await writeDraft(tab.info, bytes);
      savedHash.current = hash;
      if (alive.current) {
        setSaveStatus("Saved");
        setMarkup(currentMarkup());
      }
    })();
    saving.current = job;
    try {
      await job;
    } catch (error) {
      if (alive.current) setSaveStatus("Save failed · retry from menu");
      throw error;
    } finally {
      if (saving.current === job) saving.current = null;
    }
  };
  const refreshColors = () => {
    engine.current?.viewer.refresh();
  };
  const previewOriginal = (active: boolean) => {
    if (previewRef.current === active) return;
    previewRef.current = active;
    setPreview(active);
    refreshColors();
  };
  const navigate = (page: number) => {
    const v = engine.current?.viewer;
    if (v && Number.isFinite(page))
      v.currentPageNumber = Math.min(
        Math.max(Math.round(page), 1),
        v.pagesCount,
      );
  };
  const search = (text: string, previous = false) => {
    setSearchOpen(true);
    setQuery(text);
    engine.current?.bus.dispatch("find", {
      source: window,
      type: "again",
      query: text,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };
  const changeTool = (value: "select" | "highlight" | "comment") => {
    const e = engine.current;
    if (!e?.ui) return;
    setTool(value);
    if (value === "comment") {
      const editor = e.ui.firstSelectedEditor;
      if (editor) void editComment({ editor } as MarkupItem);
      else if (!window.getSelection()?.isCollapsed)
        e.ui.commentSelection("limbo_toolbar");
      else {
        setSidebar(true);
        setSideTab("annotations");
        setStatus("Select text, then choose Comment to attach a note.");
      }
    } else if (value === "highlight" && !window.getSelection()?.isCollapsed)
      e.ui.highlightSelection("limbo_toolbar");
    else
      e.viewer.annotationEditorMode = {
        mode:
          value === "highlight"
            ? pdfjs.AnnotationEditorType.HIGHLIGHT
            : pdfjs.AnnotationEditorType.NONE,
      };
  };
  const resolveEditor = async (item: MarkupItem) => {
    if (item.editor) return item.editor;
    const e = engine.current;
    if (!e?.ui) return null;
    navigate(item.page);
    e.viewer.annotationEditorMode = {
      mode: pdfjs.AnnotationEditorType.HIGHLIGHT,
    };
    setTool("highlight");
    for (let attempt = 0; attempt < 100 && alive.current; attempt++) {
      const editor = [...e.ui.getEditors(item.page - 1)].find(
        (editor) => editor.annotationElementId === item.id,
      );
      if (editor) return editor;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      "This annotation could not enter edit mode. Its saved contents have been preserved.",
    );
  };
  const deleteMarkup = async (item: MarkupItem) => {
    const editor = await resolveEditor(item);
    if (!editor) return;
    engine.current?.ui?.setSelected(editor);
    engine.current?.ui?.delete();
    setMarkup(currentMarkup());
    await flush();
  };
  const editComment = async (item: MarkupItem) => {
    const editor = await resolveEditor(item);
    if (!editor || !engine.current?.ui) return;
    const value = await ask(
      "Comment on this highlight",
      editor.comment?.text || "",
      true,
    );
    if (value === null) return;
    const ui = engine.current.ui,
      previous = editor.comment;
    ui.addCommands({
      cmd: () => {
        editor.comment = value;
        ui.addToAnnotationStorage(editor);
        setMarkup(currentMarkup());
      },
      undo: () => {
        editor.comment = previous || "";
        ui.addToAnnotationStorage(editor);
        setMarkup(currentMarkup());
      },
      mustExec: true,
    });
    await flush();
  };
  const exportCurrent = async () => {
    await flush();
    const e = engine.current;
    if (e)
      await exportPdf(
        tab.info,
        e.doc.annotationStorage.size
          ? await e.doc.saveDocument()
          : await e.doc.getData(),
      );
  };
  const print = async () => {
    await flush();
    const e = engine.current;
    if (!e) return;
    setStatus("Preparing original-color pages for printing…");
    const printTask = pdfjs.getDocument({
      data: e.doc.annotationStorage.size
        ? await e.doc.saveDocument()
        : await e.doc.getData(),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    });
    const printDoc = await printTask.promise;
    const root = document.createElement("div");
    root.className = "print-pages";
    document.body.append(root);
    const urls: string[] = [];
    try {
      for (let n = 1; n <= printDoc.numPages; n++) {
        const page = await printDoc.getPage(n),
          viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) =>
            b ? resolve(b) : reject(new Error("Print image failed")),
          ),
        );
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = new Image();
        img.src = url;
        img.style.aspectRatio = String(viewport.width / viewport.height);
        await img.decode();
        root.append(img);
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
      await new Promise<void>((resolve) => {
        window.addEventListener("afterprint", () => resolve(), { once: true });
        window.print();
      });
    } finally {
      await printTask.destroy();
      root.remove();
      urls.forEach(URL.revokeObjectURL);
      setStatus(
        classes.current.get(state.current.page)?.reason || "Original colors",
      );
    }
  };
  useImperativeHandle(ref, () => ({
    get document() {
      return engine.current?.doc || null;
    },
    state: () => state.current,
    flush,
    export: exportCurrent,
    print,
    navigate,
    zoom: (value) => {
      if (engine.current) engine.current.viewer.currentScaleValue = value;
      update({ zoom: value });
    },
    rotate: () => {
      const rotation = (state.current.rotation + 90) % 360;
      if (engine.current) engine.current.viewer.pagesRotation = rotation;
      update({ rotation });
    },
    search,
    tool: changeTool,
    undo: () => engine.current?.ui?.undo(),
    redo: () => engine.current?.ui?.redo(),
    refreshColors,
    previewOriginal,
    bookmark: () =>
      update({
        bookmarks: reading.bookmarks.includes(reading.page)
          ? reading.bookmarks.filter((p) => p !== reading.page)
          : [...reading.bookmarks, reading.page].sort((a, b) => a - b),
      }),
    toggleOriginal: () => {
      update({
        originals: reading.originals.includes(reading.page)
          ? reading.originals.filter((p) => p !== reading.page)
          : [...reading.originals, reading.page],
      });
      refreshColors();
    },
    editComment,
    deleteMarkup: (item) => {
      void deleteMarkup(item).catch(onError);
    },
  }));

  useEffect(() => {
    alive.current = true;
    let disposed = false,
      task: pdfjs.PDFDocumentLoadingTask | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const setup = async () => {
      const draft = await readDraft(tab.info);
      const input = draft
        ? { data: draft }
        : await source(tab.info, (error) => {
            onError(error);
            void task?.destroy();
          });
      if (disposed) return;
      task = pdfjs.getDocument({
        ...input,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        iccUrl: "/pdfjs/iccs/",
        enableXfa: false,
        useWasm: true,
        disableAutoFetch: true,
      });
      task.onPassword = (
        submit: (password: string) => void,
        reason: number,
      ) => {
        void ask(
          reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
            ? "Incorrect password — try again"
            : "This PDF needs a password",
        ).then((password) => {
          if (password === null) {
            setFailure(
              "Password entry cancelled. Close and reopen this PDF to try again.",
            );
            void task?.destroy();
          } else submit(password);
        });
      };
      const doc = await task.promise;
      if (disposed) {
        await task.destroy();
        return;
      }
      const originalGetPage = doc.getPage.bind(doc),
        patched = new Set<number>();
      doc.getPage = async (n: number) => {
        const page = await originalGetPage(n);
        if (patched.has(n)) return page;
        patched.add(n);
        const originalRender = page.render.bind(page);
        page.render = ((options: any) => {
          let real: pdfjs.RenderTask | null = null,
            cancelled = false,
            continuation: any = null;
          const promise = (async () => {
            let classification = classes.current.get(n);
            if (!classification) {
              let pending = classTasks.current.get(n);
              if (!pending) {
                pending = classifyPage(page, originalRender);
                classTasks.current.set(n, pending);
              }
              classification = await pending;
              classes.current.set(n, classification);
            }
            if (cancelled || disposed)
              throw new pdfjs.RenderingCancelledException(
                "Render cancelled",
                0,
              );
            const smart =
              state.current.mode === "smart" &&
              classification.dark &&
              !state.current.originals.includes(n) &&
              !previewRef.current;
            const canvas = options.canvas || options.canvasContext?.canvas;
            if (canvas) {
              canvas.__limboDark = smart && options.intent !== "print";
              canvas.style.filter =
                state.current.mode === "invert" && !previewRef.current
                  ? "invert(1)"
                  : "";
            }
            real = originalRender(options);
            if (continuation) real.onContinue = continuation;
            return real.promise;
          })();
          return {
            promise,
            cancel: () => {
              cancelled = true;
              real?.cancel();
            },
            get onContinue() {
              return continuation;
            },
            set onContinue(fn: any) {
              continuation = fn;
              if (real) real.onContinue = fn;
            },
            get separateAnnots() {
              return real?.separateAnnots || false;
            },
          };
        }) as typeof page.render;
        return page;
      };
      const bus = new EventBus();
      const links = new PDFLinkService({
        eventBus: bus,
        externalLinkTarget: 2,
        externalLinkRel: "noopener noreferrer",
      });
      links.addLinkAttributes = (link: HTMLAnchorElement, url: string) => {
        link.href = "#";
        link.onclick = (event) => {
          event.preventDefault();
          void externalLink(url).catch(onError);
        };
      };
      const find = new PDFFindController({ eventBus: bus, linkService: links });
      const commentManager = {
        setSidebarUiManager: () => {},
        destroy: () => {},
        hideSidebar: () => {},
        destroyPopup: () => {},
        updateComment: () => setMarkup(currentMarkup()),
        updatePopupColor: () => {},
        removeComments: () => setMarkup(currentMarkup()),
        toggleCommentPopup: (editor: any, selected: boolean) => {
          if (selected && editor.comment?.text) {
            setSidebar(true);
            setSideTab("annotations");
            setMarkup(currentMarkup());
          }
        },
        makeCommentColor: () => "#bca2f5",
        dialogElement: document.createElement("div"),
        showSidebar: () => {
          setSidebar(true);
          setSideTab("annotations");
          setMarkup(currentMarkup());
        },
        showDialog: (_ui: any, editor: any) => {
          void editComment({ editor } as MarkupItem).catch(onError);
        },
      };
      const viewer = new PDFViewer({
        container: container.current!,
        viewer: pages.current!,
        eventBus: bus,
        linkService: links,
        findController: find,
        annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
        annotationEditorHighlightColors:
          "Violet=#bca2f5,Gold=#f2ce76,Mint=#86d4b2",
        annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
        removePageBorders: true,
        maxCanvasPixels: 8 * 1024 * 1024,
        enableDetailCanvas: false,
        imagesRightClickMinSize: -1,
        enableAutoLinking: false,
        enableHighlightFloatingButton: true,
        commentManager,
      } as any);
      engine.current = { viewer, bus, doc, ui: null };
      savedHash.current = doc.annotationStorage.serializable.hash;
      bus.on("showannotationeditorui", ({ mode }: any) => {
        viewer.annotationEditorMode = { mode };
        setTool(
          mode === pdfjs.AnnotationEditorType.HIGHLIGHT
            ? "highlight"
            : "select",
        );
      });
      links.setViewer(viewer);
      links.setDocument(doc);
      find.setDocument(doc);
      bus.on("annotationeditoruimanager", ({ uiManager }: any) => {
        if (engine.current) engine.current.ui = uiManager;
      });
      bus.on("pagesinit", () => {
        viewer.currentScaleValue = state.current.zoom;
        viewer.pagesRotation = state.current.rotation;
        viewer.scrollMode = state.current.single
          ? ScrollMode.PAGE
          : ScrollMode.VERTICAL;
        viewer.currentPageNumber = Math.min(state.current.page, doc.numPages);
        if (alive.current) {
          setReady(true);
          onReady();
        }
      });
      bus.on("pagechanging", ({ pageNumber }: any) => {
        if (!alive.current) return;
        update({ page: pageNumber });
        setStatus(classes.current.get(pageNumber)?.reason || "Rendering page…");
      });
      bus.on("pagerendered", ({ pageNumber, error }: any) => {
        if (error && error.name !== "RenderingCancelledException")
          onError(error);
        if (!alive.current) return;
        if (pageNumber === state.current.page)
          setStatus(
            classes.current.get(pageNumber)?.reason || "Original colors",
          );
        setMarkup(currentMarkup());
      });
      bus.on("updatefindmatchescount", ({ matchesCount }: any) =>
        setMatches(`${matchesCount.current} / ${matchesCount.total}`),
      );
      bus.on("updatefindcontrolstate", ({ state: value }: any) => {
        if (value === 1) setMatches("No matches");
      });
      viewer.setDocument(doc);
      setCount(doc.numPages);
      setOutline(((await doc.getOutline()) || []) as OutlineItem[]);
      if (draft) setSaveStatus("Draft restored");
      let lastError = "";
      timer = setInterval(() => {
        if (
          interaction.current.pointer ||
          Date.now() - interaction.current.last < 1200 ||
          !window.getSelection()?.isCollapsed ||
          document.querySelector(".modal-shade")
        )
          return;
        void flush(false).catch((e) => {
          const message = String(e);
          if (lastError !== message) {
            lastError = message;
            onError(e);
          }
        });
      }, 2000);
    };
    void setup().catch((error) => {
      if (!disposed) {
        setFailure(String(error));
        onError(error);
      }
    });
    return () => {
      disposed = true;
      alive.current = false;
      clearInterval(timer);
      const e = engine.current;
      engine.current = null;
      e?.viewer.setDocument(null as any);
      void task?.destroy();
    };
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const resize = new ResizeObserver(() => {
      const v = engine.current?.viewer;
      if (v && !/^\d/.test(state.current.zoom)) {
        v.currentScaleValue = state.current.zoom;
        v.update();
      }
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) search(query);
      else engine.current?.bus.dispatch("findbarclose", { source: window });
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (
      !saveStatus ||
      saveStatus.startsWith("Save failed") ||
      saveStatus === "Saving…"
    )
      return;
    const timeout = setTimeout(() => setSaveStatus(""), 2400);
    return () => clearTimeout(timeout);
  }, [saveStatus]);
  useEffect(() => {
    const markInteraction = (event: Event) => {
      interaction.current.last = Date.now();
      if (event.type === "pointerdown") interaction.current.pointer = true;
      if (
        event.type === "pointerup" ||
        event.type === "pointercancel" ||
        event.type === "blur"
      )
        interaction.current.pointer = false;
    };
    const events = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "keydown",
      "blur",
    ];
    events.forEach((name) => window.addEventListener(name, markInteraction));
    return () =>
      events.forEach((name) =>
        window.removeEventListener(name, markInteraction),
      );
  }, []);
  useEffect(() => {
    if (!ready || !sidebar || sideTab !== "chapters" || !engine.current) return;
    let cancelled = false;
    void resolveChapterPages(
      engine.current.doc,
      outline,
      chapterPages.current,
      () => {
        if (!cancelled) updateChapters((v) => v + 1);
      },
      () => cancelled,
    ).catch(onError);
    return () => {
      cancelled = true;
    };
  }, [ready, sidebar, sideTab, outline]);
  useEffect(() => {
    if (!sidebar || sideTab !== "annotations" || !ready) return;
    let cancelled = false;
    const collect = async () => {
      const doc = engine.current?.doc;
      if (!doc) return;
      const found: MarkupItem[] = [];
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const annotations = await (await doc.getPage(n)).getAnnotations();
        for (const annotation of annotations)
          if (annotation.annotationType === 9)
            found.push({
              id: annotation.id,
              page: n,
              text: "Highlighted passage",
              comment: annotation.contentsObj?.str || "",
              color: "#bca2f5",
            });
        if (!cancelled) {
          storedMarkup.current = [...found];
          setMarkup(currentMarkup());
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    void collect().catch((error) => {
      if (!cancelled) onError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [sidebar, sideTab, ready]);
  const handle = () => engine.current?.viewer;
  const run = (job: () => void | Promise<void>) => {
    try {
      const result = job();
      if (result) void result.catch(onError);
    } catch (e) {
      onError(e);
    }
  };
  const outlineNodes = (items: OutlineItem[], depth = 0): React.ReactNode =>
    items.map((item, i) => (
      <div key={`${depth}-${i}`}>
        <button
          className="outline-item"
          aria-label={item.title}
          title={
            chapterPages.current.get(destinationKey(item.dest))
              ? `Page ${chapterPages.current.get(destinationKey(item.dest))!.label}`
              : item.title
          }
          style={{ paddingLeft: 14 + depth * 13 }}
          onClick={() => {
            if (item.dest)
              void (
                engine.current?.viewer.linkService as PDFLinkService
              ).goToDestination(item.dest as any);
          }}
        >
          <span>{item.title}</span>
          <span className="chapter-page">
            {chapterPages.current.get(destinationKey(item.dest))?.label || ""}
          </span>
        </button>
        {outlineNodes(item.items || [], depth + 1)}
      </div>
    ));
  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="tool-cluster">
          <ToolButton
            icon="sidebar"
            label="Toggle sidebar"
            active={sidebar}
            onClick={() => setSidebar(!sidebar)}
          />
          <ToolButton
            icon="search"
            label="Search document (Ctrl+F)"
            active={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          />
        </div>
        <div className="page-navigation">
          <ToolButton
            icon="left"
            label="Previous page"
            disabled={!ready || reading.page === 1}
            onClick={() => navigate(reading.page - 1)}
          />
          <input
            aria-label="Page number"
            type="number"
            min="1"
            max={count}
            value={reading.page}
            onChange={(e) => navigate(Number(e.target.value))}
          />
          <span>/ {count || "—"}</span>
          <ToolButton
            icon="right"
            label="Next page"
            disabled={!ready || reading.page === count}
            onClick={() => navigate(reading.page + 1)}
          />
        </div>
        <div className="tool-cluster zoom-controls">
          <ToolButton
            icon="zoom"
            label="Zoom out"
            disabled={!ready}
            onClick={() => {
              const v = handle();
              if (v) {
                v.currentScale = Math.max(0.25, v.currentScale / 1.2);
                update({ zoom: String(v.currentScale) });
              }
            }}
          />
          <select
            aria-label="Zoom"
            value={reading.zoom}
            onChange={(e) => {
              if (handle()) handle()!.currentScaleValue = e.target.value;
              update({ zoom: e.target.value });
            }}
          >
            <option value="page-width">Fit width</option>
            <option value="page-fit">Fit page</option>
            {["0.5", "0.75", "1", "1.25", "1.5", "2", "3", "4"].map((x) => (
              <option key={x} value={x}>
                {Number(x) * 100}%
              </option>
            ))}
            {![
              "page-width",
              "page-fit",
              "0.5",
              "0.75",
              "1",
              "1.25",
              "1.5",
              "2",
              "3",
              "4",
            ].includes(reading.zoom) && (
              <option value={reading.zoom}>
                {Math.round(Number(reading.zoom) * 100)}%
              </option>
            )}
          </select>
          <ToolButton
            icon="zoomIn"
            label="Zoom in"
            disabled={!ready}
            onClick={() => {
              const v = handle();
              if (v) {
                v.currentScale = Math.min(5, v.currentScale * 1.2);
                update({ zoom: String(v.currentScale) });
              }
            }}
          />
        </div>
        <div className="toolbar-spacer" />
        <select
          className="color-mode"
          aria-label="Page colors"
          title={status}
          value={reading.mode}
          onChange={(e) => {
            update({ mode: e.target.value as ReadingState["mode"] });
            refreshColors();
          }}
        >
          <option value="smart">☾ Smart Dark</option>
          <option value="original">☼ Original</option>
          <option value="invert">◐ Full Invert</option>
        </select>
        <div className="tool-cluster markup-tools">
          <ToolButton
            icon="cursor"
            label="Select text"
            active={tool === "select"}
            onClick={() => changeTool("select")}
          />
          <ToolButton
            icon="highlight"
            label="Highlight text"
            active={tool === "highlight"}
            onClick={() => changeTool("highlight")}
          />
          <ToolButton
            icon="comment"
            label="Comment on selection"
            active={tool === "comment"}
            onClick={() => changeTool("comment")}
          />
        </div>
        <div className="menu-anchor">
          <ToolButton
            icon="more"
            label="More reading tools"
            active={more}
            onClick={() => setMore(!more)}
          />
          {more && (
            <div
              className="app-menu reader-menu"
              onClick={() => setMore(false)}
            >
              <button onClick={() => changeTool("select")}>
                <Icon name="cursor" />
                Select text
              </button>
              <button onClick={() => changeTool("highlight")}>
                <Icon name="highlight" />
                Highlight text
              </button>
              <button onClick={() => changeTool("comment")}>
                <Icon name="comment" />
                Comment on selection
              </button>
              <hr />
              <button
                onClick={() => {
                  const rotation = (reading.rotation + 90) % 360;
                  if (handle()) handle()!.pagesRotation = rotation;
                  update({ rotation });
                }}
              >
                <Icon name="rotate" />
                Rotate clockwise
              </button>
              <button
                onClick={() => {
                  const single = !reading.single;
                  if (handle())
                    handle()!.scrollMode = single
                      ? ScrollMode.PAGE
                      : ScrollMode.VERTICAL;
                  update({ single });
                }}
              >
                <Icon name={reading.single ? "continuous" : "single"} />
                {reading.single ? "Continuous scrolling" : "Single page view"}
              </button>
              <button
                onClick={() =>
                  update({
                    bookmarks: reading.bookmarks.includes(reading.page)
                      ? reading.bookmarks.filter((p) => p !== reading.page)
                      : [...reading.bookmarks, reading.page].sort(
                          (a, b) => a - b,
                        ),
                  })
                }
              >
                <Icon name="bookmark" />
                {reading.bookmarks.includes(reading.page)
                  ? "Remove bookmark"
                  : "Bookmark this page"}
              </button>
              <button
                onClick={() => {
                  update({
                    originals: reading.originals.includes(reading.page)
                      ? reading.originals.filter((p) => p !== reading.page)
                      : [...reading.originals, reading.page],
                  });
                  refreshColors();
                }}
              >
                <Icon name="sun" />
                {reading.originals.includes(reading.page)
                  ? "Use document color mode"
                  : "Always show this page in original"}
              </button>
              <button onClick={onSplit}>
                <Icon name="split" />
                Split right <kbd>Ctrl+\</kbd>
              </button>
              <hr />
              <button onClick={() => engine.current?.ui?.undo()}>
                <Icon name="undo" />
                Undo <kbd>Ctrl+Z</kbd>
              </button>
              <button onClick={() => engine.current?.ui?.redo()}>
                <Icon name="redo" />
                Redo <kbd>Ctrl+Y</kbd>
              </button>
              <button onClick={() => run(flush)}>
                <Icon name="check" />
                Save local draft <kbd>Ctrl+S</kbd>
              </button>
              <button onClick={() => run(exportCurrent)}>
                <Icon name="export" />
                Export annotated PDF
              </button>
              <button onClick={() => run(print)}>
                <Icon name="print" />
                Print original colors <kbd>Ctrl+P</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
      {searchOpen && (
        <div className="find-bar">
          <Icon name="search" />
          <input
            aria-label="Search PDF"
            placeholder="Find in this document…"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query, e.shiftKey);
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          <span>{matches}</span>
          <ToolButton
            icon="left"
            label="Previous match"
            onClick={() => search(query, true)}
          />
          <ToolButton
            icon="right"
            label="Next match"
            onClick={() => search(query)}
          />
          <ToolButton
            icon="close"
            label="Close search"
            onClick={() => {
              setSearchOpen(false);
              engine.current?.bus.dispatch("findbarclose", { source: window });
            }}
          />
        </div>
      )}
      <div className="reader-body">
        {sidebar && (
          <aside className="reader-sidebar">
            <div className="sidebar-tabs">
              {[
                ["chapters", "chapters"],
                ["thumbnails", "thumbnails"],
                ["bookmarks", "bookmark"],
                ["annotations", "comment"],
              ].map(([id, icon]) => (
                <ToolButton
                  key={id}
                  icon={icon}
                  label={id[0].toUpperCase() + id.slice(1)}
                  active={sideTab === id}
                  onClick={() => {
                    setSideTab(id);
                    setMarkup(currentMarkup());
                  }}
                />
              ))}
            </div>
            <div className="sidebar-heading">{sideTab}</div>
            <div className="sidebar-content">
              {sideTab === "chapters" &&
                (outline.length ? (
                  outlineNodes(outline)
                ) : (
                  <p className="empty-message">
                    This PDF has no chapter outline. Use thumbnails or add
                    bookmarks to find your place.
                  </p>
                ))}
              {sideTab === "bookmarks" &&
                (reading.bookmarks.length ? (
                  reading.bookmarks.map((p) => (
                    <button
                      className="bookmark-item"
                      key={p}
                      onClick={() => navigate(p)}
                    >
                      <Icon name="bookmark" />
                      Page {p}
                    </button>
                  ))
                ) : (
                  <p className="empty-message">
                    Keep a place worth returning to. Bookmark a page from the
                    reading menu.
                  </p>
                ))}
              {sideTab === "thumbnails" && (
                <div className="thumbnails">
                  {Array.from({ length: count }, (_, i) => (
                    <Thumbnail
                      key={i}
                      page={i + 1}
                      doc={engine.current?.doc || null}
                      selected={reading.page === i + 1}
                      navigate={navigate}
                    />
                  ))}
                </div>
              )}
              {sideTab === "annotations" &&
                (markup.length ? (
                  markup.map((item) => (
                    <div className="markup-card" key={item.id}>
                      <button
                        className="markup-location"
                        onClick={() => navigate(item.page)}
                      >
                        PAGE {item.page}
                      </button>
                      <p>{item.comment || item.text}</p>
                      <div>
                        <button onClick={() => run(() => editComment(item))}>
                          Edit comment
                        </button>
                        <ToolButton
                          icon="trash"
                          label="Delete annotation"
                          onClick={() => run(() => deleteMarkup(item))}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-message">
                    Select text and choose Highlight. Add a comment to a
                    selected highlight to keep a note with it.
                  </p>
                ))}
            </div>
          </aside>
        )}
        <div className="viewer-stage">
          <div
            className="viewer-container"
            ref={container}
            tabIndex={0}
            onMouseDownCapture={(event) => {
              if (
                event.button === 0 &&
                (event.target as Element).closest(".textLayer .editToolbar")
              )
                event.preventDefault();
            }}
          >
            <div ref={pages} className="pdfViewer" />
          </div>
          {!ready && !failure && (
            <div className="loading-overlay">
              <span className="spinner" />
              Opening your document…
            </div>
          )}
          {failure && (
            <div className="loading-overlay error-state">
              <Icon name="info" size={28} />
              <h3>Couldn’t open this PDF</h3>
              <p>{failure}</p>
            </div>
          )}
          {ready && (
            <>
              <button
                className="preview-button"
                aria-label={"Hold original colors (\\)"}
                aria-pressed={preview}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  previewOriginal(true);
                }}
                onPointerUp={() => previewOriginal(false)}
                onPointerCancel={() => previewOriginal(false)}
                onBlur={() => previewOriginal(false)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    previewOriginal(true);
                  }
                }}
                onKeyUp={() => previewOriginal(false)}
                title={"Hold to preview original colors (\\)"}
              >
                <Icon name="eye" size={14} />
                <span>Original</span>
                <kbd>\</kbd>
              </button>
              {saveStatus && (
                <div className="save-status" role="status">
                  {saveStatus}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function Thumbnail({
  page,
  doc,
  selected,
  navigate,
}: {
  page: number;
  doc: pdfjs.PDFDocumentProxy | null;
  selected: boolean;
  navigate: (p: number) => void;
}) {
  const button = useRef<HTMLButtonElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!doc || !button.current) return;
    let cancelled = false,
      task: pdfjs.RenderTask | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void doc
          .getPage(page)
          .then((p) => {
            if (cancelled || !canvas.current) return;
            const viewport = p.getViewport({
              scale: 124 / p.getViewport({ scale: 1 }).width,
            });
            canvas.current.width = Math.ceil(viewport.width);
            canvas.current.height = Math.ceil(viewport.height);
            task = p.render({
              canvas: canvas.current,
              viewport,
              annotationMode: 0,
            });
            return task.promise;
          })
          .catch(() => {});
      },
      { rootMargin: "150px" },
    );
    observer.observe(button.current);
    return () => {
      cancelled = true;
      task?.cancel();
      observer.disconnect();
    };
  }, [doc, page]);
  return (
    <button
      ref={button}
      className={`thumbnail ${selected ? "selected" : ""}`}
      onClick={() => navigate(page)}
      aria-label={`Go to page ${page}`}
    >
      <canvas ref={canvas} />
      <span>{page}</span>
    </button>
  );
}
