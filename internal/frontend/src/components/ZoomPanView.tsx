import { useCallback, useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 2;

interface ZoomPanViewProps {
  children: React.ReactNode;
  className?: string;
}

export function ZoomPanView({ children, className = "" }: ZoomPanViewProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const justPanned = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoomRef.current((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan.x, pan.y],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (panStart.current === null) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        justPanned.current = true;
        setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
      }
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    panStart.current = null;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (justPanned.current) {
      e.preventDefault();
      e.stopPropagation();
      justPanned.current = false;
    }
  }, []);

  const handleReset = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <button
        type="button"
        className="absolute right-2 top-2 z-10 rounded border border-gh-border bg-gh-bg px-2 py-1 text-xs text-gh-text-secondary hover:bg-gh-bg-hover"
        onClick={handleReset}
        title="重置缩放与位置"
      >
        重置
      </button>
      <div
        ref={wrapperRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClickCapture={handleClick}
      >
        <div
          className="inline-block origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
