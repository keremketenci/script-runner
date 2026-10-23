import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import { ResizeHandle } from "@/components/ResizeHandle";
import { clamp, SIDEBAR_WIDTH } from "@/lib/settings";
import { useSettings } from "@/settings/SettingsContext";

/** Width of the icon rail in compact mode; row icons sit inside it */
const RAIL_WIDTH = 52;
// Small delays so the rail does not flicker open when the mouse only passes by
const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 250;

/**
 * The left sidebar. Its width can be dragged; in compact mode it shrinks to an icon rail
 * and opens on top of the content while the mouse is over it.
 */
export function AppSidebar({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const compact = settings.sidebarCompact;
  // Follows the pointer while dragging; saved to the settings when the drag ends
  const [width, setWidth] = useState(settings.sidebarWidth);
  const [hovered, setHovered] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => setWidth(settings.sidebarWidth), [settings.sidebarWidth]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const hoverAfter = (value: boolean, delay: number) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setHovered(value), delay);
  };

  const collapsed = compact && !hovered;
  // Never wider than part of the window, so a small window keeps room for the content
  const fullWidth = `min(${width}px, ${compact ? 80 : 40}vw)`;

  const resizeTo = (clientX: number) => {
    const left = outerRef.current?.getBoundingClientRect().left ?? 0;
    setWidth(clamp(clientX - left, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max));
  };
  const saveWidth = (value: number) =>
    updateSettings({ sidebarWidth: clamp(value, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) });

  return (
    <>
      {/* Takes the space in the layout; in compact mode only the rail's width */}
      <div
        ref={outerRef}
        className="relative shrink-0"
        style={{ width: compact ? RAIL_WIDTH : fullWidth }}
      >
        <div
          data-collapsed={collapsed}
          onMouseEnter={() => compact && hoverAfter(true, OPEN_DELAY_MS)}
          onMouseLeave={() => compact && hoverAfter(false, CLOSE_DELAY_MS)}
          className={cn(
            "group/sidebar absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-background transition-[width,box-shadow] duration-200",
            // Opened from the rail it floats over the content, so give it an edge
            compact && !collapsed && "rounded-r-lg border-r shadow-lg",
          )}
          style={{ width: collapsed ? RAIL_WIDTH : fullWidth }}
        >
          {/* Content always has the full width and is clipped by the rail, so icons stay put */}
          <div className="flex min-h-0 flex-1 flex-col gap-4" style={{ width: fullWidth }}>
            <div className="flex px-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label={compact ? t("sidebar.expand") : t("sidebar.compact")}
                title={compact ? t("sidebar.expand") : t("sidebar.compact")}
                onClick={() => {
                  setHovered(false);
                  updateSettings({ sidebarCompact: !compact });
                }}
              >
                {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-2 pb-2">
              {children}
            </div>
          </div>
        </div>
      </div>

      {compact ? (
        // Same gap as the handle, so the content does not move when switching modes
        <div className="w-4 shrink-0" />
      ) : (
        <ResizeHandle
          between="column"
          label={t("sidebar.resize")}
          onResize={(clientX) => resizeTo(clientX)}
          onResizeEnd={() => saveWidth(width)}
          onStep={(pixels) => saveWidth(width + pixels)}
          onReset={() => saveWidth(SIDEBAR_WIDTH.initial)}
        />
      )}
    </>
  );
}
