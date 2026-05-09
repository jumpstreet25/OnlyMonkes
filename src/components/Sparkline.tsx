/**
 * Sparkline — tiny line chart drawn with Skia for embedding in list rows.
 *
 * No axes, no labels, no cursor. Just a clean stroke with a soft area fill,
 * coloured by direction (first → last close). Designed for ~80–120 px wide
 * × ~32–40 px tall, ~20–30 data points.
 *
 * Falls back to a flat baseline if the closes array is empty/single-point —
 * this keeps the row layout stable for tokens that have no scanner cache yet.
 */

import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia, LinearGradient, vec } from '@shopify/react-native-skia';
import { THEME } from '@/lib/constants';

interface SparklineProps {
  closes: number[];
  width?: number;
  height?: number;
  /** Override the auto-detected up/down color. */
  colorOverride?: string;
}

export function Sparkline({ closes, width = 96, height = 36, colorOverride }: SparklineProps) {
  const { strokePath, areaPath, color } = useMemo(() => {
    const w = Math.max(2, width);
    const h = Math.max(2, height);
    const pts = closes.filter(n => Number.isFinite(n) && n > 0);

    // Empty / single point — flat line at vertical center
    if (pts.length < 2) {
      const stroke = Skia.Path.Make();
      stroke.moveTo(0, h / 2);
      stroke.lineTo(w, h / 2);
      const area = Skia.Path.Make();
      return { strokePath: stroke, areaPath: area, color: THEME.textMuted };
    }

    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min;
    const denom = range === 0 ? 1 : range;
    const stepX = w / (pts.length - 1);

    // Map each price to (x, y) — flip Y because Skia's origin is top-left
    // and we want higher prices to render closer to the top.
    const xy = pts.map((p, i) => {
      const x = i * stepX;
      const y = h - ((p - min) / denom) * h;
      return { x, y };
    });

    // Stroke path: simple linear segments. Skipping cubic smoothing keeps
    // the chart honest — sparklines distort easily with smoothing.
    const stroke = Skia.Path.Make();
    stroke.moveTo(xy[0].x, xy[0].y);
    for (let i = 1; i < xy.length; i++) stroke.lineTo(xy[i].x, xy[i].y);

    // Area path: same line, then close back along the bottom for the fill.
    const area = Skia.Path.Make();
    area.moveTo(xy[0].x, h);
    area.lineTo(xy[0].x, xy[0].y);
    for (let i = 1; i < xy.length; i++) area.lineTo(xy[i].x, xy[i].y);
    area.lineTo(xy[xy.length - 1].x, h);
    area.close();

    const isUp = pts[pts.length - 1] >= pts[0];
    const c = colorOverride ?? (isUp ? THEME.gold : THEME.error);

    return { strokePath: stroke, areaPath: area, color: c };
  }, [closes, width, height, colorOverride]);

  return (
    <View style={{ width, height }}>
      <Canvas style={{ flex: 1 }}>
        <Path path={areaPath} style="fill">
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[color + '55', color + '00']}
          />
        </Path>
        <Path path={strokePath} style="stroke" strokeWidth={1.6} color={color} strokeCap="round" strokeJoin="round" />
      </Canvas>
    </View>
  );
}
