import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Reader } from "./Reader";
import { Icon, ToolButton } from "./Icon";
import {
  choosePdfs,
  clearRecents,
  desktop,
  openBrowserFile,
  openPath,
  readState,
  recentFiles,
} from "./platform";
import {
  defaultReading,
  type DocumentInfo,
  type Group,
  type ReaderHandle,
  type ReadingState,
  type RecentFile,
  type Tab,
} from "./types";

interface Dialog {
  title: string;
  initial: string;
  multiline: boolean;
  resolve: (text: string | null) => void;
}
const emptyGroup = (): Group => ({ tabs: [], active: null });
export default function App() {
  const [groups, setGroups] = useState<Group[]>([emptyGroup()]),
    [focused, setFocused] = useState(0),
    [ratio, setRatio] = useState(50);
  const groupRef = useRef(groups),
    focusedRef = useRef(focused);
  groupRef.current = groups;
  focusedRef.current = focused;
  const readers = useRef(new Map<string, ReaderHandle>()),
    operations = useRef(Promise.resolve());
  const [recents, setRecents] = useState<RecentFile[]>([]),
    [toast, setToast] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [focusMode, setFocusMode] = useState(false),
    [help, setHelp] = useState(false),
    [appMenu, setAppMenu] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
      id: string;
      group: number;
      x: number;
      y: number;
    } | null>(null),
    [dragging, setDragging] = useState(false);
  const [maximized, setMaximized] = useState(false),
    [busy, setBusy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const tabDrag = useRef<{
    id: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const draggedAt = useRef(-Infinity);
  const [dragGhost, setDragGhost] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const pendingWindowAck = useRef(false);
  const acknowledgeReader = () => {
    if (desktop && pendingWindowAck.current) {
      pendingWindowAck.current = false;
      void invoke("window_ready").catch(onError);
    }
  };
  const appWindow = useRef(desktop ? getCurrentWindow() : null),
    maximize = useRef<HTMLButtonElement>(null);
  const onError = useCallback((error: unknown) => {
    console.error(error);
    setToast(String(error).replace(/^Error: /, ""));
  }, []);
  const ask = useCallback(
    (title: string, initial = "", multiline = false) =>
      new Promise<string | null>((resolve) =>
        setDialog({ title, initial, multiline, resolve }),
      ),
    [],
  );
  const activeReader = () =>
    readers.current.get(groupRef.current[focusedRef.current]?.active || "");
  const serialize = (job: () => Promise<void>) => {
    operations.current = operations.current.then(job).catch(onError);
  };
  const flushGroup = async (index: number) => {
    const id = groupRef.current[index]?.active;
    if (id) await readers.current.get(id)?.flush();
  };
  const addDocuments = async (
    infos: DocumentInfo[],
    groupIndex = focusedRef.current,
    states?: Record<string, ReadingState>,
  ) => {
    for (const info of infos) {
      if (
        (info as any).owner &&
        (info as any).owner !== appWindow.current?.label
      )
        continue;
      const existing = groupRef.current.findIndex((g) =>
        g.tabs.some((t) => t.info.id === info.id),
      );
      if (existing >= 0) {
        await activate(existing, info.id);
        continue;
      }
      const state = {
        ...defaultReading(),
        ...(await readState(info)),
        ...states?.[info.id],
      };
      await flushGroup(groupIndex);
      setGroups((current) => {
        const next = current.map((g) => ({ ...g, tabs: [...g.tabs] }));
        if (!next[groupIndex]) groupIndex = 0;
        next[groupIndex].tabs.push({ info, state });
        next[groupIndex].active = info.id;
        groupRef.current = next;
        return next;
      });
      if (info.draftChanged)
        setToast(
          "This PDF changed outside Limbo. Its older draft was kept separately; the changed file is opening without that draft.",
        );
      setFocused(groupIndex);
      focusedRef.current = groupIndex;
    }
    setRecents(await recentFiles());
  };
  const openFiles = () =>
    serialize(async () => {
      setBusy(true);
      try {
        await addDocuments(await choosePdfs());
      } finally {
        setBusy(false);
      }
    });
  const activate = async (index: number, id: string) => {
    if (groupRef.current[index]?.active !== id) await flushGroup(index);
    setGroups((current) => {
      const next = current.map((g, i) =>
        i === index ? { ...g, active: id } : g,
      );
      groupRef.current = next;
      return next;
    });
    setFocused(index);
    focusedRef.current = index;
  };
  const closeTab = (index: number, id: string, transferred = false) =>
    serialize(async () => {
      await readers.current.get(id)?.flush();
      if (desktop && !transferred) await invoke("close_document", { id });
      setGroups((current) => {
        const next = current.map((g, i) => {
          if (i !== index) return g;
          const at = g.tabs.findIndex((t) => t.info.id === id),
            tabs = g.tabs.filter((t) => t.info.id !== id);
          return {
            tabs,
            active:
              g.active === id
                ? tabs[Math.max(0, at - 1)]?.info.id || null
                : g.active,
          };
        });
        groupRef.current = next;
        return next;
      });
    });
  const split = () =>
    serialize(async () => {
      if (groupRef.current.length === 2) {
        await Promise.all([flushGroup(0), flushGroup(1)]);
        setGroups((current) => {
          const next = [
            {
              tabs: [...current[0].tabs, ...current[1].tabs],
              active: current[focusedRef.current]?.active || current[0].active,
            },
          ];
          groupRef.current = next;
          return next;
        });
        setFocused(0);
        focusedRef.current = 0;
        return;
      }
      const group = groupRef.current[0],
        active = group.active;
      await flushGroup(0);
      setGroups((current) => {
        const g = current[0];
        if (g.tabs.length < 2) return [g, emptyGroup()];
        const moving = g.tabs.find((t) => t.info.id === active)!;
        const left = g.tabs.filter((t) => t !== moving);
        const next = [
          { tabs: left, active: left.at(-1)!.info.id },
          { tabs: [moving], active },
        ];
        groupRef.current = next;
        return next;
      });
      setFocused(1);
      focusedRef.current = 1;
    });
  const moveTab = (id: string, target: number, before?: string) =>
    serialize(async () => {
      const source = groupRef.current.findIndex((g) =>
        g.tabs.some((t) => t.info.id === id),
      );
      if (source < 0) return;
      await flushGroup(source);
      if (source !== target) await flushGroup(target);
      setGroups((current) => {
        const tab = current[source].tabs.find((t) => t.info.id === id)!;
        const next = current.map((g) => ({
          tabs: g.tabs.filter((t) => t.info.id !== id),
          active: g.active,
        }));
        const at = before
          ? next[target].tabs.findIndex((t) => t.info.id === before)
          : -1;
        next[target].tabs.splice(
          at < 0 ? next[target].tabs.length : at,
          0,
          tab,
        );
        if (source !== target && next[source].active === id)
          next[source].active = next[source].tabs.at(-1)?.info.id || null;
        next[target].active = id;
        groupRef.current = next;
        return next;
      });
      setFocused(target);
      focusedRef.current = target;
    });
  const detach = (id: string) =>
    serialize(async () => {
      if (!desktop) {
        setToast(
          "Separate windows are available in the installed Windows app.",
        );
        return;
      }
      const index = groupRef.current.findIndex((g) =>
        g.tabs.some((t) => t.info.id === id),
      );
      if (index < 0) return;
      const tab = groupRef.current[index].tabs.find((t) => t.info.id === id)!;
      setTransferring(true);
      try {
        await flushGroup(index);
        await readers.current.get(id)?.flush();
        const state = readers.current.get(id)?.state() || tab.state;
        // The native command only resolves after the destination acknowledges readiness.
        await invoke("transfer_document", { id, reading: state });
        setGroups((current) => {
          const next = current.map((g, i) => {
            if (i !== index) return g;
            const tabs = g.tabs.filter((t) => t.info.id !== id);
            return {
              tabs,
              active: g.active === id ? tabs.at(-1)?.info.id || null : g.active,
            };
          });
          groupRef.current = next;
          return next;
        });
      } finally {
        setTransferring(false);
      }
    });
  const updateState = (id: string, state: ReadingState) =>
    setGroups((current) => {
      const next = current.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.info.id === id ? { ...t, state } : t)),
      }));
      groupRef.current = next;
      return next;
    });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 12000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    void recentFiles().then(setRecents).catch(onError);
    const cleanups: (() => void)[] = [];
    let stopped = false;
    if (desktop) {
      const register = async () => {
        const keep = (fn: () => void) => {
          if (stopped) fn();
          else cleanups.push(fn);
        };
        keep(
          await listen<{
            documents: DocumentInfo[];
            reading?: Record<string, ReadingState>;
          }>("open-documents", (event) =>
            serialize(async () => {
              await addDocuments(
                event.payload.documents,
                0,
                event.payload.reading,
              );
            }),
          ),
        );
        keep(
          await listen<string>("focus-document", (event) => {
            const index = groupRef.current.findIndex((g) =>
              g.tabs.some((t) => t.info.id === event.payload),
            );
            if (index >= 0) serialize(() => activate(index, event.payload));
          }),
        );
        keep(
          await appWindow.current!.onDragDropEvent((event) => {
            if (event.payload.type === "over") setDragging(true);
            else if (event.payload.type === "leave") setDragging(false);
            else if (event.payload.type === "drop") {
              setDragging(false);
              serialize(async () => {
                const infos: DocumentInfo[] = [];
                for (const path of event.payload.type === "drop"
                  ? event.payload.paths
                  : []) {
                  if (/\.pdf$/i.test(path)) infos.push(await openPath(path));
                }
                await addDocuments(infos);
              });
            }
          }),
        );
        keep(
          await appWindow.current!.onCloseRequested(async (event) => {
            event.preventDefault();
            try {
              await operations.current;
              for (const reader of readers.current.values())
                await reader.flush();
              await invoke("close_window_documents");
              await appWindow.current!.destroy();
            } catch (error) {
              onError(error);
            }
          }),
        );
        keep(
          await appWindow.current!.onFocusChanged((event) => {
            if (event.payload) void invoke("window_focused");
          }),
        );
        keep(
          await appWindow.current!.onResized(() => {
            void appWindow.current!.isMaximized().then(setMaximized);
          }),
        );
        const payload = await invoke<{
          documents: DocumentInfo[];
          reading: Record<string, ReadingState>;
        }>("initial_documents");
        if (!stopped) {
          pendingWindowAck.current = payload.documents.length > 0;
          await addDocuments(payload.documents, 0, payload.reading);
          if (!payload.documents.length) await invoke("window_ready");
        }
      };
      void register().catch(onError);
    }
    return () => {
      stopped = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const input = (event.target as HTMLElement)?.closest(
        'input,textarea,[contenteditable="true"]',
      );
      const ctrl = event.ctrlKey || event.metaKey;
      if (dialog) {
        if (event.key === "Escape") {
          dialog.resolve(null);
          setDialog(null);
        }
        return;
      }
      if (ctrl && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openFiles();
      } else if (ctrl && event.code === "Backslash") {
        event.preventDefault();
        split();
      } else if (event.key === "F6") {
        event.preventDefault();
        if (groupRef.current.length === 2) {
          const next = 1 - focusedRef.current;
          focusedRef.current = next;
          setFocused(next);
          document
            .querySelectorAll<HTMLElement>(".viewer-container")
            [next]?.focus();
        }
      } else if (ctrl && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        const id = groupRef.current[focusedRef.current]?.active;
        if (id) detach(id);
      } else if (ctrl && event.key.toLowerCase() === "w") {
        event.preventDefault();
        const g = groupRef.current[focusedRef.current];
        if (g.active) closeTab(focusedRef.current, g.active);
      } else if (ctrl && event.key === "Tab") {
        event.preventDefault();
        const g = groupRef.current[focusedRef.current],
          at = g.tabs.findIndex((t) => t.info.id === g.active);
        const tab =
          g.tabs[
            (at + (event.shiftKey ? -1 : 1) + g.tabs.length) % g.tabs.length
          ];
        if (tab) serialize(() => activate(focusedRef.current, tab.info.id));
      } else if (event.key === "F11") {
        event.preventDefault();
        if (desktop)
          void appWindow
            .current!.isFullscreen()
            .then((value) => appWindow.current!.setFullscreen(!value));
        else if (!document.fullscreenElement)
          void document.documentElement.requestFullscreen();
        else void document.exitFullscreen();
      } else if (event.key === "Escape" && !input) {
        setFocusMode(false);
        setAppMenu(false);
        setTabMenu(null);
      } else if (ctrl && event.key.toLowerCase() === "f") {
        event.preventDefault();
        activeReader()?.search("");
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>(
                '.pane.focused [aria-label="Search PDF"]',
              )
              ?.focus(),
          0,
        );
      } else if (ctrl && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const reader = activeReader();
        if (reader)
          void (event.shiftKey ? reader.export() : reader.flush()).catch(
            onError,
          );
      } else if (ctrl && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void activeReader()?.print().catch(onError);
      } else if (ctrl && !input && event.key.toLowerCase() === "d") {
        event.preventDefault();
        activeReader()?.bookmark();
      } else if (!input && event.key === "?") setHelp(true);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dialog]);
  useEffect(() => {
    if (!desktop || !maximize.current) return;
    const updateRect = () => {
      const r = maximize.current!.getBoundingClientRect();
      void invoke("set_caption_rect", {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      }).catch(onError);
    };
    const observer = new ResizeObserver(updateRect);
    observer.observe(document.documentElement);
    updateRect();
    return () => observer.disconnect();
  }, [focusMode]);
  const activeName = groups[focused]?.tabs.find(
    (t) => t.info.id === groups[focused].active,
  )?.info.name;
  return (
    <div
      className={`app ${focusMode ? "focus-mode" : ""}`}
      onClick={() => {
        if (tabMenu) setTabMenu(null);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDrop={(event) => {
        if (desktop || !event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        serialize(async () =>
          addDocuments(
            await Promise.all(
              Array.from(event.dataTransfer.files)
                .filter((f) => /\.pdf$/i.test(f.name))
                .map(openBrowserFile),
            ),
          ),
        );
      }}
    >
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          void appWindow.current?.toggleMaximize();
        }}
      >
        <div className="brand" data-tauri-drag-region>
          <Icon name="key" size={19} />
          <span data-tauri-drag-region>
            limbo<span className="brand-dot">.</span>
          </span>
        </div>
        <span className="titlebar-document" data-tauri-drag-region>
          {activeName || "A quieter place to read"}
        </span>
        <div className="app-actions">
          <ToolButton
            icon="open"
            label="Open PDF (Ctrl+O)"
            onClick={openFiles}
            disabled={busy}
          />
          <ToolButton
            icon="split"
            label="Toggle split view (Ctrl+\)"
            active={groups.length === 2}
            onClick={split}
          />
          <ToolButton
            icon="fullscreen"
            label="Focus mode"
            active={focusMode}
            onClick={() => setFocusMode(!focusMode)}
          />
          <div className="menu-anchor">
            <ToolButton
              icon="more"
              label="App menu"
              onClick={() => setAppMenu(!appMenu)}
            />
            {appMenu && (
              <div className="dropdown app-dropdown">
                <button
                  onClick={() => {
                    openFiles();
                    setAppMenu(false);
                  }}
                >
                  <Icon name="open" />
                  Open PDF <kbd>Ctrl+O</kbd>
                </button>
                <button
                  onClick={() => {
                    setHelp(true);
                    setAppMenu(false);
                  }}
                >
                  <Icon name="info" />
                  Shortcuts & about
                </button>
                <button
                  onClick={() => {
                    void clearRecents()
                      .then(() => setRecents([]))
                      .catch(onError);
                    setAppMenu(false);
                  }}
                >
                  <Icon name="trash" />
                  Clear recent files
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            onClick={() => void appWindow.current?.minimize()}
          >
            <Icon name="minimize" size={16} />
          </button>
          <button
            ref={maximize}
            aria-label="Maximize window"
            onClick={() => void appWindow.current?.toggleMaximize()}
          >
            <Icon name={maximized ? "restore" : "maximize"} size={14} />
          </button>
          <button
            className="window-close"
            aria-label="Close window"
            onClick={() => void appWindow.current?.close()}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </header>
      <main
        className="workspace"
        style={{
          gridTemplateColumns:
            groups.length === 2 ? `${ratio}fr 5px ${100 - ratio}fr` : "1fr",
        }}
      >
        {groups.map((group, index) => (
          <div
            className="pane-fragment"
            key={index}
            style={{ display: "contents" }}
          >
            {index === 1 && (
              <div
                className="split-divider"
                role="separator"
                aria-label="Resize split panes"
                aria-orientation="vertical"
                aria-valuenow={ratio}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft")
                    setRatio((r) => Math.max(20, r - 2));
                  if (e.key === "ArrowRight")
                    setRatio((r) => Math.min(80, r + 2));
                }}
                onDoubleClick={() => setRatio(50)}
                onPointerDown={(event) => {
                  const el = event.currentTarget;
                  el.setPointerCapture(event.pointerId);
                  const move = (e: PointerEvent) => {
                    const r = el.parentElement!.getBoundingClientRect();
                    setRatio(
                      Math.max(
                        20,
                        Math.min(80, ((e.clientX - r.left) / r.width) * 100),
                      ),
                    );
                  };
                  const up = () => {
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                  };
                  el.addEventListener("pointermove", move);
                  el.addEventListener("pointerup", up);
                }}
              />
            )}
            <section
              data-limbo-group={index}
              className={`pane ${focused === index ? "focused" : ""}`}
              onPointerDownCapture={() => {
                focusedRef.current = index;
                setFocused(index);
              }}
              onFocusCapture={() => {
                focusedRef.current = index;
                setFocused(index);
              }}
            >
              {(group.tabs.length > 0 || groups.length === 2) && (
                <div className="tabstrip">
                  {group.tabs.map((tab) => (
                    <div
                      key={tab.info.id}
                      className={`document-tab ${group.active === tab.info.id ? "active" : ""}`}
                      role="tab"
                      data-limbo-tab={tab.info.id}
                      aria-selected={group.active === tab.info.id}
                      onPointerDown={(event) => {
                        if (
                          event.button !== 0 ||
                          (event.target as Element).closest("button")
                        )
                          return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        tabDrag.current = {
                          id: tab.info.id,
                          x: event.clientX,
                          y: event.clientY,
                          active: false,
                        };
                      }}
                      onPointerMove={(event) => {
                        const drag = tabDrag.current;
                        if (!drag || drag.id !== tab.info.id) return;
                        if (
                          Math.hypot(
                            event.clientX - drag.x,
                            event.clientY - drag.y,
                          ) > 6
                        )
                          drag.active = true;
                        if (drag.active)
                          setDragGhost({
                            name: tab.info.name,
                            x: event.clientX + 10,
                            y: event.clientY + 14,
                          });
                      }}
                      onPointerCancel={() => {
                        tabDrag.current = null;
                        setDragGhost(null);
                      }}
                      onPointerUp={(event) => {
                        const drag = tabDrag.current;
                        tabDrag.current = null;
                        setDragGhost(null);
                        if (
                          event.currentTarget.hasPointerCapture(event.pointerId)
                        )
                          event.currentTarget.releasePointerCapture(
                            event.pointerId,
                          );
                        if (!drag?.active) return;
                        draggedAt.current = performance.now();
                        const target = document.elementFromPoint(
                          event.clientX,
                          event.clientY,
                        );
                        const group =
                          target?.closest<HTMLElement>("[data-limbo-group]");
                        const before =
                          target?.closest<HTMLElement>("[data-limbo-tab]")
                            ?.dataset.limboTab;
                        if (group && before !== drag.id)
                          moveTab(
                            drag.id,
                            Number(group.dataset.limboGroup),
                            before,
                          );
                        else if (
                          !group &&
                          (event.clientX < 0 ||
                            event.clientY < 0 ||
                            event.clientX > window.innerWidth ||
                            event.clientY > window.innerHeight)
                        )
                          detach(drag.id);
                      }}
                      onClick={() => {
                        if (performance.now() - draggedAt.current > 300)
                          serialize(() => activate(index, tab.info.id));
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setTabMenu({
                          id: tab.info.id,
                          group: index,
                          x: Math.min(e.clientX, window.innerWidth - 245),
                          y: e.clientY,
                        });
                      }}
                      title={tab.info.path}
                    >
                      <Icon name="file" size={14} />
                      <span>{tab.info.name}</span>
                      <button
                        aria-label={`Close ${tab.info.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(index, tab.info.id);
                        }}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ))}
                  <ToolButton
                    icon="plus"
                    label="Open another PDF"
                    onClick={openFiles}
                  />
                </div>
              )}
              {group.active ? (
                group.tabs
                  .filter((t) => t.info.id === group.active)
                  .map((tab) => (
                    <Reader
                      key={tab.info.id}
                      ref={(reader) => {
                        if (reader) readers.current.set(tab.info.id, reader);
                        else readers.current.delete(tab.info.id);
                      }}
                      tab={tab}
                      onState={(state) => updateState(tab.info.id, state)}
                      ask={ask}
                      onError={onError}
                      onSplit={split}
                      onReady={acknowledgeReader}
                    />
                  ))
              ) : (
                <Welcome
                  compact={groups.length === 2}
                  open={openFiles}
                  recents={recents}
                  onRecent={(path) =>
                    serialize(async () => {
                      if (desktop) await addDocuments([await openPath(path)]);
                      else
                        setToast(
                          "Choose the file again using Open PDF in browser preview.",
                        );
                    })
                  }
                  clear={() =>
                    void clearRecents()
                      .then(() => setRecents([]))
                      .catch(onError)
                  }
                />
              )}
            </section>
          </div>
        ))}
      </main>
      {focusMode && (
        <button
          className="leave-focus"
          onClick={() => setFocusMode(false)}
          title="Leave focus mode (Escape)"
        >
          <Icon name="fullscreen" size={15} />
          Leave focus <kbd>Esc</kbd>
        </button>
      )}
      {dragGhost && (
        <div
          className="tab-drag-ghost"
          style={{ left: dragGhost.x, top: dragGhost.y }}
        >
          <Icon name="file" size={14} />
          {dragGhost.name}
        </div>
      )}
      {transferring && (
        <div className="transfer-overlay">
          <span className="spinner" />
          Moving your document to its new window…
        </div>
      )}
      {dragging && (
        <div className="drop-overlay" onDragLeave={() => setDragging(false)}>
          <Icon name="open" size={45} />
          <h2>Drop into Limbo</h2>
          <p>Your next quiet chapter.</p>
        </div>
      )}
      {tabMenu && (
        <div
          className="dropdown tab-context"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          <button
            onClick={() => {
              if (groups.length === 1) split();
              else moveTab(tabMenu.id, 1 - tabMenu.group);
            }}
          >
            <Icon name="split" />
            Move to other pane
          </button>
          <button onClick={() => detach(tabMenu.id)}>
            <Icon name="window" />
            Move to new window
          </button>
          <hr />
          <button onClick={() => closeTab(tabMenu.group, tabMenu.id)}>
            <Icon name="close" />
            Close tab <kbd>Ctrl+W</kbd>
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="alert">
          <Icon name="info" />
          <span>{toast}</span>
          <ToolButton
            icon="close"
            label="Dismiss notification"
            onClick={() => setToast("")}
          />
        </div>
      )}
      {dialog && (
        <TextDialog
          dialog={dialog}
          close={(value) => {
            dialog.resolve(value);
            setDialog(null);
          }}
        />
      )}
      {help && (
        <div className="modal-shade" onClick={() => setHelp(false)}>
          <section
            className="about-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <ToolButton
              icon="close"
              label="Close about"
              onClick={() => setHelp(false)}
            />
            <div className="about-brand">
              <Icon name="key" size={28} />
              <h2>
                limbo<span>.</span>
              </h2>
            </div>
            <p>A quieter place to read. Version 0.1.0</p>
            <div className="shortcut-list">
              {[
                ["Open PDF", "Ctrl+O"],
                ["Search document", "Ctrl+F"],
                ["Save local draft", "Ctrl+S"],
                ["Export annotated copy", "Ctrl+Shift+S"],
                ["Split / merge panes", "Ctrl+\\"],
                ["Switch pane", "F6"],
                ["Move tab to new window", "Ctrl+Shift+N"],
                ["Next / previous tab", "Ctrl(+Shift)+Tab"],
                ["Bookmark page", "Ctrl+D"],
                ["Print", "Ctrl+P"],
                ["Fullscreen", "F11"],
                ["Windows Snap Layouts", "Win+Z"],
                ["Snap window left / right", "Win+← / →"],
                ["Leave focus mode", "Esc"],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <p className="about-footnote">
              Local files. No accounts or telemetry required to read.
              <br />
              MIT · PDF.js Apache-2.0 · Tauri MIT/Apache-2.0
              <br />
              Full license notices are included with the installer.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
function Welcome({
  compact,
  open,
  recents,
  onRecent,
  clear,
}: {
  compact: boolean;
  open: () => void;
  recents: RecentFile[];
  onRecent: (path: string) => void;
  clear: () => void;
}) {
  return (
    <div className={`welcome ${compact ? "compact" : ""}`}>
      <div className="starfield" aria-hidden="true">
        {Array.from({ length: 32 }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 37 + 13) % 100}%`,
              top: `${(i * 23 + 7) % 100}%`,
              opacity: 0.15 + (i % 4) * 0.1,
            }}
          />
        ))}
      </div>
      <div className="welcome-content">
        <div className="eyebrow">
          <span />
          YOUR SPACE BETWEEN CHAPTERS
        </div>
        <div className="limbo-emblem">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <path d="M61 19 87 43 72 69 42 77 30 52 61 19M61 19 60 53 87 43M60 53 42 77M60 53 72 69" />
            <circle cx="61" cy="19" r="3" />
            <circle cx="87" cy="43" r="2" />
            <circle cx="72" cy="69" r="2.5" />
            <circle cx="42" cy="77" r="2" />
            <circle cx="30" cy="52" r="2" />
            <circle cx="60" cy="53" r="4" />
            <path className="emblem-key" d="m60 56 0 40m0-9h10m-10-8h7" />
          </svg>
        </div>
        <h1>
          Read a little
          <br />
          <span>closer to the dark.</span>
        </h1>
        <p className="welcome-copy">
          Your PDFs. A quieter canvas.
          <br />
          Thoughtful tools, nothing in the way.
        </p>
        <button className="primary-button" onClick={open}>
          <Icon name="open" size={18} />
          Open a PDF<span>Ctrl O</span>
        </button>
        <p className="drop-hint">or drop a PDF anywhere</p>
        {recents.length > 0 && (
          <div className="recents">
            <div className="recents-heading">
              <span>RECENTLY OPENED</span>
              <button onClick={clear}>Clear</button>
            </div>
            {recents.slice(0, 4).map((file) => (
              <button
                className="recent-file"
                key={file.path}
                onClick={() => onRecent(file.path)}
              >
                <span className="recent-icon">
                  <Icon name="file" size={18} />
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.path}</small>
                </span>
                <Icon name="right" size={15} />
              </button>
            ))}
          </div>
        )}
        <div className="welcome-features">
          <span>
            <Icon name="moon" size={14} />
            Smart Dark
          </span>
          <span>
            <Icon name="highlight" size={14} />
            Make your mark
          </span>
          <span>
            <Icon name="split" size={14} />
            Read side by side
          </span>
        </div>
      </div>
      <div className="welcome-footer">
        <span>LIMBO READER</span>
        <span>
          OFFLINE BY DESIGN <i />
        </span>
      </div>
    </div>
  );
}
function TextDialog({
  dialog,
  close,
}: {
  dialog: Dialog;
  close: (value: string | null) => void;
}) {
  const [value, setValue] = useState(dialog.initial);
  return (
    <div className="modal-shade">
      <form
        className="text-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close(value);
        }}
      >
        <h2>{dialog.title}</h2>
        {dialog.multiline ? (
          <textarea
            aria-label="Comment"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={7}
          />
        ) : (
          <input
            aria-label="PDF password"
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            {dialog.multiline ? "Save comment" : "Open PDF"}
          </button>
        </div>
      </form>
    </div>
  );
}
