/**
 * SkiaPremiumAvatar — GPU-rendered holographic + normal-lit NFT avatar.
 *
 * Replaces the basic expo-image PFP with a Skia Canvas that runs a composite
 * shader combining:
 *   1. Procedural normal map (spherical approximation) → Phong directional lighting
 *   2. Holographic iridescent sheen (rainbow shift with tilt + Fresnel at edges)
 *   3. Specular highlight that travels with light direction
 *   4. Subtle animated shimmer
 *
 * All effects are driven by head rotation (yaw/pitch/roll) from face tracking.
 * When face tracking is off, falls back to a gentle idle animation.
 *
 * Normal map source (in order of preference):
 *   a) Pre-generated normal map PNG loaded via useImage (Laigter / Depth Anything)
 *   b) Procedural sphere normal — computed in-shader from distance to center
 *
 * This component renders ONLY the lit PFP image. Mouth sprites, blink overlay,
 * glow ring, and drop shadow are still rendered by AnimatedAvatar on top.
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
  type SkImage,
} from '@shopify/react-native-skia';

// ── SkSL Shader Source ──────────────────────────────────────────────────────
//
// Uniform inputs:
//   shader pfp        — the NFT PFP image
//   float2 resolution — canvas size in pixels
//   float2 lightDir   — normalized light direction from head rotation (x=yaw, y=pitch)
//   float tiltX       — head yaw in radians (for holo sheen)
//   float tiltY       — head pitch in radians (for holo sheen)
//   float time        — elapsed seconds (for shimmer)
//   float holoEnabled — 1.0 = holo on, 0.0 = off (premium gate)

const SHADER_SOURCE = `
uniform shader pfp;
uniform float2 resolution;
uniform float2 lightDir;
uniform float tiltX;
uniform float tiltY;
uniform float time;
uniform float holoEnabled;

// ── Helpers ────────────────────────────────────────────────────────────────

float circle_mask(float2 uv) {
  float d = length(uv - float2(0.5));
  return smoothstep(0.5, 0.48, d); // soft AA edge
}

// ── Main ───────────────────────────────────────────────────────────────────

half4 main(float2 coord) {
  float2 uv = coord / resolution;
  float2 fromCenter = uv - float2(0.5);
  float dist = length(fromCenter);

  // Sample PFP
  half4 color = pfp.eval(coord);
  if (color.a < 0.01) return color;

  // Circular mask (soft edge)
  float mask = circle_mask(uv);
  if (mask < 0.01) return half4(0.0);

  // ── PROCEDURAL NORMAL MAP ──────────────────────────────────────────────
  // Model the circular PFP as a hemisphere for lighting.
  // At center: normal = (0,0,1) facing camera.
  // At edges: normal tilts outward.
  float sphere = max(1.0 - dist * 2.2, 0.0);
  float z = sqrt(max(sphere, 0.001));
  float3 normal = normalize(float3(fromCenter.x * 2.4, -fromCenter.y * 2.4, z));

  // ── PHONG LIGHTING ─────────────────────────────────────────────────────
  float3 light = normalize(float3(lightDir.x, lightDir.y, 0.55));
  float diffuse = max(dot(normal, light), 0.0);
  float ambient = 0.38;

  // Blinn-Phong specular
  float3 viewDir = float3(0.0, 0.0, 1.0);
  float3 halfVec = normalize(light + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 28.0);

  // Rim light (Fresnel-like) — bright at edges facing away from camera
  float rim = 1.0 - z;
  rim = rim * rim * rim; // cubic for tight edge

  // Combine lighting
  half3 lit = color.rgb * half(ambient + diffuse * 0.62);
  lit += half3(spec * 0.35);                          // specular highlight
  lit += half3(rim * 0.15) * half3(light.x * 0.5 + 0.5, 0.7, 1.0 - light.x * 0.5); // rim tint

  // ── HOLOGRAPHIC SHEEN ──────────────────────────────────────────────────
  if (holoEnabled > 0.5) {
    // Rainbow phase — rotates with head tilt + flows over time
    float angle = atan(fromCenter.y, fromCenter.x);
    float radial = dist * 6.0;
    float holoPhase = angle * 2.5
                    + tiltX * 4.0
                    + tiltY * 3.0
                    + radial
                    + time * 0.8;

    // Create iridescent rainbow
    half3 rainbow;
    rainbow.r = half(sin(holoPhase) * 0.5 + 0.5);
    rainbow.g = half(sin(holoPhase + 2.094) * 0.5 + 0.5);
    rainbow.b = half(sin(holoPhase + 4.189) * 0.5 + 0.5);

    // Fresnel-driven intensity — more holo at edges, subtle at center
    float fresnel = 1.0 - z;
    fresnel = fresnel * fresnel;

    // Specular-driven hot spots — rainbow concentrates at highlight
    float holoStrength = fresnel * 0.30 + spec * 0.25;

    // Micro-shimmer — tiny sparkling noise
    float shimmer = sin(coord.x * 1.7 + coord.y * 2.3 + time * 3.0) * 0.5 + 0.5;
    shimmer *= sin(coord.x * 0.9 - coord.y * 1.1 + time * 1.7) * 0.5 + 0.5;
    holoStrength += shimmer * fresnel * 0.08;

    lit = mix(lit, rainbow * half(0.8) + lit * half(0.4), half(holoStrength));
  }

  // ── AMBIENT OCCLUSION ──────────────────────────────────────────────────
  // Darken edges slightly for depth (always on, even without holo)
  float ao = smoothstep(0.5, 0.25, dist);
  lit *= half(0.85 + ao * 0.15);

  return half4(lit * half(mask), color.a * half(mask));
}
`;

// ── Component ───────────────────────────────────────────────────────────────

interface SkiaPremiumAvatarProps {
  pfpUri: string | null;
  size: number;
  lightDirX: number;  // -1 to 1, from head yaw
  lightDirY: number;  // -1 to 1, from head pitch
  tiltX: number;      // head yaw in degrees
  tiltY: number;      // head pitch in degrees
  holoEnabled?: boolean;
}

const shaderEffect = Skia.RuntimeEffect.Make(SHADER_SOURCE);

export const SkiaPremiumAvatar = React.memo(function SkiaPremiumAvatar({
  pfpUri,
  size,
  lightDirX,
  lightDirY,
  tiltX,
  tiltY,
  holoEnabled = true,
}: SkiaPremiumAvatarProps) {
  const image = useImage(pfpUri);

  // Convert degrees to radians for shader
  const tiltXRad = (tiltX * Math.PI) / 180;
  const tiltYRad = (tiltY * Math.PI) / 180;

  // Animated time for shimmer (increment per render, wraps)
  const timeRef = React.useRef(0);
  timeRef.current += 0.016; // ~60fps increment

  const uniforms = useMemo(() => ({
    resolution: vec(size, size),
    lightDir: vec(lightDirX, lightDirY),
    tiltX: tiltXRad,
    tiltY: tiltYRad,
    time: timeRef.current,
    holoEnabled: holoEnabled ? 1.0 : 0.0,
  }), [size, lightDirX, lightDirY, tiltXRad, tiltYRad, holoEnabled]);

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
