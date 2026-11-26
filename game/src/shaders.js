// GLSL for the storm-dusk look. One shared sky function (used by the sky and reflected by the sea), a lit
// shader for solid things (terrain, aircraft, props) with height fog, a sea shader with layered swell,
// fresnel sky reflection, sun and lightning glint and shore foam, and a soft billboard cloud shader.

const SKY_FN = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }

vec3 skyColour(vec3 dir, vec3 sun, vec3 fog, float flash, float time) {
  float up = dir.y;
  float toSun = max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), normalize(vec3(sun.x, 0.0, sun.z))), 0.0);
  vec3 zenith = vec3(0.035, 0.035, 0.11);
  vec3 mid = vec3(0.17, 0.09, 0.27);
  vec3 band = mix(vec3(0.6, 0.18, 0.32), vec3(1.25, 0.5, 0.18), pow(toSun, 3.0));
  vec3 sky = mix(band, mid, smoothstep(0.0, 0.14, up));
  sky = mix(sky, zenith, smoothstep(0.12, 0.65, up));
  sky = mix(sky, fog, smoothstep(0.03, -0.1, up));
  // storm deck: rolling cloud over the upper sky, its underside lit by the ember band
  vec2 cp = dir.xz / max(up, 0.06) * 1.3 + vec2(time * 0.012, time * 0.004);
  float c = fbm(cp);
  float deck = smoothstep(0.38, 0.72, c) * smoothstep(0.04, 0.25, up);
  vec3 under = mix(vec3(0.05, 0.04, 0.09), vec3(0.75, 0.3, 0.24), pow(toSun, 3.0) * (1.0 - smoothstep(0.06, 0.45, up)));
  under += vec3(0.5, 0.25, 0.3) * smoothstep(0.62, 0.72, c) * pow(toSun, 2.0) * 0.5;
  sky = mix(sky, under, deck * 0.92);
  float s = max(dot(dir, sun), 0.0);
  sky += vec3(1.2, 0.55, 0.22) * (pow(s, 5.0) * 0.4 + pow(s, 48.0) * 0.8) + vec3(1.6, 1.3, 1.0) * pow(s, 1600.0) * 6.0;
  sky += vec3(0.55, 0.65, 1.0) * flash * (0.35 + deck * 1.2) * smoothstep(-0.05, 0.3, up);
  return sky;
}

vec3 applyFog(vec3 c, vec3 world, vec3 cam, vec3 fog, float density, float flash) {
  float d = length(cam - world);
  // denser low over the sea, thinning with height: depth toward the horizon, clear air up high
  float h = max(min(world.y, cam.y), 0.0);
  float f = 1.0 - exp(-pow(d * density, 1.35) * exp(-h / 650.0));
  return mix(c, fog + vec3(0.55, 0.65, 1.0) * flash * 0.15, clamp(f, 0.0, 1.0));
}
`;

export const LIT_VERT = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in vec3 aCol;
uniform mat4 uModel;
uniform mat4 uVP;
out vec3 vNrm;
out vec3 vCol;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol;
  gl_Position = uVP * w;
}`;

export const LIT_FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vCol;
in vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uCam;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uEmissive;
uniform float uAlpha;
uniform float uTime;
uniform float uFlash;
uniform float uTerrain;
uniform vec3 uTint;
out vec4 outColor;
${SKY_FN}
const vec3 SUN_COL = vec3(1.25, 0.62, 0.3);

void main() {
  vec3 n = normalize(vNrm);
  vec3 col = vCol * uTint;
  vec3 view = normalize(uCam - vWorld);
  if (uTerrain > 0.5) {
    // fine variation and a dark wet band just above the waterline
    col *= 0.88 + 0.24 * noise(vWorld.xz * 0.06);
    col = mix(col * 0.55, col, smoothstep(0.4, 3.5, vWorld.y));
  }
  float diff = max(dot(n, uSun), 0.0);
  float wrap = max(dot(n, uSun) * 0.5 + 0.5, 0.0);
  vec3 amb = mix(vec3(0.06, 0.05, 0.09), vec3(0.2, 0.24, 0.42), n.y * 0.5 + 0.5);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0) * pow(max(dot(-view, uSun) * 0.5 + 0.5, 0.0), 2.0);
  vec3 lit = col * (diff * SUN_COL * 1.05 + wrap * SUN_COL * 0.08 + amb * 1.1);
  lit += SUN_COL * rim * 0.55;
  lit += col * vec3(0.55, 0.65, 1.0) * uFlash * 0.5;
  vec3 c = mix(lit, col * (1.0 + uFlash * 0.5), uEmissive);
  if (uEmissive < 0.99) c = applyFog(c, vWorld, uCam, uFog, uFogDensity, uFlash);
  outColor = vec4(c, uAlpha);
}`;

export const SEA_FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vCol;
in vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uCam;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uTime;
uniform float uFlash;
uniform sampler2D uHeight;
uniform float uWorldSize;
out vec4 outColor;
${SKY_FN}

vec3 seaNormal(vec2 p, float dist) {
  float near = exp(-dist / 900.0);
  float far = exp(-dist / 4000.0);
  vec2 g = vec2(0.0);
  g += vec2(cos(p.x * 0.031 + uTime * 0.7), cos(p.y * 0.027 - uTime * 0.6)) * 0.09 * far;
  g += vec2(cos(dot(p, vec2(0.07, 0.05)) + uTime * 1.3)) * vec2(0.07, 0.05) * 0.9 * far;
  g += vec2(cos(dot(p, vec2(-0.13, 0.16)) - uTime * 1.9)) * vec2(-0.13, 0.16) * 0.35 * near;
  g += vec2(cos(dot(p, vec2(0.31, 0.22)) + uTime * 2.7)) * vec2(0.31, 0.22) * 0.12 * near;
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main() {
  float dist = length(uCam - vWorld);
  vec3 n = seaNormal(vWorld.xz, dist);
  vec3 view = normalize(uCam - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(view, n), 0.0), 5.0);
  vec3 refl = skyColour(reflect(-view, n) * vec3(1.0, 1.0, 1.0), uSun, uFog, uFlash, uTime);
  vec3 deep = vec3(0.01, 0.03, 0.055);
  vec3 c = mix(deep, refl, clamp(fres, 0.0, 1.0));
  // glint: the low sun laying a streak across the swell, and lightning catching the crests
  vec3 h = normalize(uSun + view);
  c += vec3(1.6, 0.85, 0.4) * pow(max(dot(n, h), 0.0), 220.0) * 3.5;
  c += vec3(1.0, 0.6, 0.35) * pow(max(dot(n, h), 0.0), 18.0) * 0.12;
  c += vec3(0.6, 0.7, 1.0) * uFlash * fres * 0.6;
  // shore foam where the sea is shallow, broken up by moving noise
  vec2 uv = vWorld.xz / uWorldSize + 0.5;
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    float ground = texture(uHeight, uv).r;
    float depth = -ground;
    float band = smoothstep(9.0, 0.0, depth) * step(-2.0, ground) ;
    float lines = smoothstep(0.55, 0.85, noise(vWorld.xz * 0.12 + vec2(uTime * 0.4, -uTime * 0.3)) * (0.6 + 0.4 * sin(depth * 1.4 - uTime * 2.0)));
    c = mix(c, vec3(0.82, 0.78, 0.86), band * lines * 0.85 * exp(-dist / 2500.0));
    c = mix(c, vec3(0.06, 0.12, 0.14), smoothstep(6.0, 0.0, depth) * 0.35);
  }
  c = applyFog(c, vWorld, uCam, uFog, uFogDensity, uFlash);
  outColor = vec4(c, 1.0);
}`;

export const SKY_VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
void main() {
  vNdc = P[gl_VertexID];
  gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0);
}`;

export const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uSun;
uniform vec3 uFog;
uniform float uFlash;
uniform float uTime;
out vec4 outColor;
${SKY_FN}
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  outColor = vec4(skyColour(dir, uSun, uFog, uFlash, uTime), 1.0);
}`;

// Soft cloud billboards: each quad carries its centre, corner and size; the fragment shader shapes a
// noisy puff, shades it dark at the core and bright on the edge facing the sun, and fogs it with distance.
export const CLOUD_VERT = `#version 300 es
in vec3 aCentre;
in vec3 aCorner;   // x, y in -1..1, z = size
in vec3 aShade;    // base brightness, seed, alpha
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out vec3 vShade;
out vec3 vWorld;
void main() {
  vec3 w = aCentre + (uRight * aCorner.x + uUp * aCorner.y * 0.62) * aCorner.z;
  vUv = aCorner.xy;
  vShade = aShade;
  vWorld = w;
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const CLOUD_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vShade;
in vec3 vWorld;
uniform vec3 uSun;
uniform vec2 uSunScreen; // the sun's direction across the billboard plane
uniform vec3 uCam;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uFlash;
uniform float uTime;
out vec4 outColor;
${SKY_FN}
void main() {
  float r = length(vUv);
  float n = fbm(vUv * 2.2 + vShade.y * 17.0 + vec2(uTime * 0.01, 0.0));
  float shape = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
  if (shape < 0.01) discard;
  // edge facing the sun glows ember; the core stays storm-dark; the base is cooler
  float lit = clamp(dot(normalize(vUv + 1e-4), uSunScreen) * 0.5 + 0.5, 0.0, 1.0);
  float edge = smoothstep(0.2, 0.95, r) * lit;
  vec3 core = vec3(0.09, 0.075, 0.14) * vShade.x;
  vec3 rim = vec3(1.25, 0.55, 0.32) * (0.6 + vShade.x * 0.6);
  vec3 c = mix(core, rim, edge * 0.85) + vec3(0.06, 0.05, 0.1) * (1.0 - vUv.y) * 0.5;
  c += vec3(0.55, 0.65, 1.0) * uFlash * (0.5 + n);
  c = applyFog(c, vWorld, uCam, uFog, uFogDensity * 0.6, uFlash);
  outColor = vec4(c, shape * vShade.z);
}`;
