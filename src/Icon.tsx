import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  open: "M3 7h6l2 2h10l-3 11H3V7Zm0 0V4h7l2 3h7v2",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  sidebar: "M3 4h18v16H3zM9 4v16M5 8h2m-2 4h2",
  split: "M3 4h18v16H3zM12 4v16",
  moon: "M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10Z",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  invert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18m0-18a9 9 0 0 1 0 18",
  zoom: "M4 12h16",
  zoomIn: "M4 12h16M12 4v16",
  rotate: "M3 10a9 9 0 1 1 2 8M3 3v7h7",
  highlight: "m5 14 8-10 6 5-8 10H5v-5Zm0 0 6 5M3 22h16",
  comment: "M21 4H3v13h5l4 4 4-4h5V4ZM7 8h10M7 12h7",
  cursor: "m5 3 14 10-7 1-3 7-4-18Z",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z",
  export: "M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6",
  print: "M6 8V3h12v5M6 17H3V8h18v9h-3M6 13h12v8H6z",
  fullscreen: "M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  minimize: "M5 16h14",
  maximize: "M5 5h14v14H5z",
  restore: "M8 8h12V3H8v5ZM4 8h12v12H4z",
  chapters: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
  thumbnails: "M3 3h7v8H3zM14 3h7v8h-7zM3 15h7v6H3zM14 15h7v6h-7z",
  file: "M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h5",
  window: "M4 10V4h16v16h-6M3 15h6v6H3zM10 14l7-7m-5 0h5v5",
  key: "M14 11a5 5 0 1 0-4-4l-8 8v5h5v-3h3v-3l4-3ZM16 5h.01",
  undo: "M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12",
  redo: "m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  single: "M6 3h12v18H6z",
  continuous: "M6 2h12v8H6zM6 14h12v8H6z",
  check: "m5 12 4 4L19 6",
  info: "M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
export function ToolButton({
  icon,
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      className={`tool ${active ? "selected" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => {
        if (icon === "highlight" || icon === "comment") event.preventDefault();
      }}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
