/**
 * Website: a vertical bar between two columns; drag it to make them narrower or
 * wider. onDrag gets the pointer's horizontal travel since the drag started.
 * While dragging, a full-window cover keeps the game/3D iframes from swallowing
 * the pointer. Double-click calls onReset.
 */
import React, { useCallback, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useThemeColor } from "@/lib/shopTheme";

export function ResizeHandle({ onDragStart, onDrag, onReset, label }: {
  onDragStart: () => void;
  onDrag: (dx: number) => void;
  onReset?: () => void;
  label: string;
}) {
  const border = useThemeColor("border");
  const accent = useThemeColor("accent");
  const [hot, setHot] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const down = useCallback((e: any) => {
    e.preventDefault?.();
    startX.current = e.clientX ?? e.nativeEvent?.clientX ?? 0;
    onDragStart();
    setDragging(true);
    const move = (ev: PointerEvent) => onDrag(ev.clientX - startX.current);
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [onDragStart, onDrag]);

  const keys = useCallback((e: any) => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault?.();
      onDragStart();
      onDrag(e.key === "ArrowLeft" ? -step : step);
    }
  }, [onDragStart, onDrag]);

  return (
    <>
      <View
        accessibilityRole={"separator" as any}
        accessibilityLabel={label}
        // react-native-web passes these straight to the DOM element.
        {...({ onPointerDown: down, onDoubleClick: onReset, onKeyDown: keys, tabIndex: 0,
          onPointerEnter: () => setHot(true), onPointerLeave: () => setHot(false) } as any)}
        style={[styles.hit, { cursor: "col-resize" } as any]}
      >
        <View style={[styles.line, { backgroundColor: hot || dragging ? accent : border }, (hot || dragging) && styles.lineHot]} />
      </View>
      {dragging && <View style={[StyleSheet.absoluteFill, styles.cover, { cursor: "col-resize" } as any]} />}
    </>
  );
}

const styles = StyleSheet.create({
  hit: { width: 9, marginHorizontal: -4, height: "100%", alignItems: "center", zIndex: 20 },
  line: { width: 1, height: "100%" },
  lineHot: { width: 3 },
  cover: { position: "fixed" as any, zIndex: 9999 },
});
