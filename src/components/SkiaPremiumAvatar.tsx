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
  float sphere = max(1.0 - dist * 2.2, 0.0);
  float z = sqrt(max(sphere, 0.001));
  float3 normal = normalize(float3(fromCenter.x * 2.4, -fromCenter.y * 2.4, z));

  // ── DIRECTIONAL DIFFUSE LIGHTING ───────────────────────────────────────
  float3 light = normalize(float3(lightDir.x, lightDir.y, 0.6));
  float diffuse = max(dot(normal, light), 0.0);
  float ambient = 0.42;

  half3 lit = color.rgb * half(ambient + diffuse * 0.58);

  // ── SOFT RIM (subtle edge definition, no color tint) ───────────────────
  float rim = 1.0 - z;
  rim = rim * rim * rim;
  lit += half3(rim * 0.08);

  // ── AMBIENT OCCLUSION (edge darkening for depth) ───────────────────────
  float ao = smoothstep(0.5, 0.2, dist);
  lit *= half(0.88 + ao * 0.12);

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
