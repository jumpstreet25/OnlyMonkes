/**
 * SkiaPremiumAvatar — GPU-rendered normal-lit NFT avatar.
 *
 * Replaces the basic expo-image PFP with a Skia Canvas running a single-pass
 * SkSL shader:
 *   1. Procedural normal map (spherical) → directional diffuse lighting
 *   2. Soft Fresnel rim highlight at edges
 *   3. Ambient occlusion (edge darkening for depth)
 *
 * Light direction driven by head rotation (yaw/pitch) from face tracking.
 * Renders ONLY the lit PFP. Mouth sprites, blink, glow ring rendered on top.
 */

import React, { useMemo } from 'react';
import {
  Canvas,
  Fill,
  Shader,
  ImageShader,
  Skia,
  useImage,
  vec,
} from '@shopify/react-native-skia';

// ── SkSL Shader Source ──────────────────────────────────────────────────────
//
// Uniform inputs:
//   shader pfp        — the NFT PFP image
//   float2 resolution — canvas size in pixels
//   float2 lightDir   — normalized light direction from head rotation (x=yaw, y=pitch)

const SHADER_SOURCE = `
uniform shader pfp;
uniform float2 resolution;
uniform float2 lightDir;

// ── Helpers ────────────────────────────────────────────────────────────────

float circle_mask(float2 uv) {
  float d = length(uv - float2(0.5));
  return smoothstep(0.5, 0.48, d);
}

// ── Main ───────────────────────────────────────────────────────────────────

half4 main(float2 coord) {
  float2 uv = coord / resolution;
  float2 fromCenter = uv - float2(0.5);
  float dist = length(fromCenter);

  half4 color = pfp.eval(coord);
  if (color.a < 0.01) return color;

  float mask = circle_mask(uv);
  if (mask < 0.01) return half4(0.0);

  // ── PROCEDURAL NORMAL MAP ──────────────────────────────────────────────
  // Tighter sphere = more curvature, more dramatic light falloff
  float sphere = max(1.0 - dist * 2.5, 0.0);
  float z = sqrt(max(sphere, 0.001));
  float3 normal = normalize(float3(fromCenter.x * 3.0, -fromCenter.y * 3.0, z));

  // ── DIRECTIONAL DIFFUSE LIGHTING ───────────────────────────────────────
  float3 light = normalize(float3(lightDir.x, lightDir.y, 0.45));
  float diffuse = max(dot(normal, light), 0.0);

  // Half-Lambert wrap: softens the shadow terminator so it doesn't clip hard
  float wrap = diffuse * 0.5 + 0.5;
  wrap = wrap * wrap; // re-contrast after wrapping

  float ambient = 0.30;
  half3 lit = color.rgb * half(ambient + wrap * 0.70);

  // ── SHADOW DARKENING (opposite side of light gets noticeably darker) ───
  float shadow = 1.0 - diffuse;
  shadow = shadow * shadow * 0.18; // quadratic falloff, max 18% darker
  lit *= half(1.0 - shadow);

  // ── RIM LIGHT (edge catch from light direction) ────────────────────────
  float rim = 1.0 - z;
  rim = rim * rim;
  // Rim stronger on the lit side
  float rimSide = max(dot(normalize(fromCenter), normalize(lightDir.xy)), 0.0);
  lit += half3(rim * 0.12 * (0.4 + rimSide * 0.6));

  // ── AMBIENT OCCLUSION (strong edge darkening) ─────────────────────────
  float ao = smoothstep(0.5, 0.15, dist);
  lit *= half(0.78 + ao * 0.22);

  return half4(lit * half(mask), color.a * half(mask));
}
`;

// ── Component ───────────────────────────────────────────────────────────────

interface SkiaPremiumAvatarProps {
  pfpUri: string | null;
  size: number;
  lightDirX: number;  // -1 to 1, from head yaw
  lightDirY: number;  // -1 to 1, from head pitch
}

const shaderEffect = Skia.RuntimeEffect.Make(SHADER_SOURCE);

export const SkiaPremiumAvatar = React.memo(function SkiaPremiumAvatar({
  pfpUri,
  size,
  lightDirX,
  lightDirY,
}: SkiaPremiumAvatarProps) {
  const image = useImage(pfpUri);

  const uniforms = useMemo(() => ({
    resolution: vec(size, size),
    lightDir: vec(lightDirX, lightDirY),
  }), [size, lightDirX, lightDirY]);

  if (!image || !shaderEffect) return null;

  return (
    <Canvas
      style={{ width: size, height: size }}
      pointerEvents="none"
    >
      <Fill>
        <Shader source={shaderEffect} uniforms={uniforms}>
          <ImageShader
            image={image}
            fit="cover"
            rect={{ x: 0, y: 0, width: size, height: size }}
          />
        </Shader>
      </Fill>
    </Canvas>
  );
});
