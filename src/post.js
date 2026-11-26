// Post-processing: the scene is drawn into a multisampled HDR framebuffer, resolved, and composited to
// the screen with bloom (bright-pass + blur at half resolution), ACES tone mapping, a storm-dusk colour
// grade, vignette and a radial speed blur. Falls back to 8-bit buffers without float support, to FXAA
// without MSAA, and to plain direct rendering if framebuffers fail altogether.

const QUAD_VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vUv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const BRIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 o;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  o = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 o;
const float W[5] = float[5](0.227, 0.194, 0.121, 0.054, 0.016);
void main() {
  vec3 c = texture(uSrc, vUv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, vUv + uDir * float(i) * 1.6).rgb * W[i];
    c += texture(uSrc, vUv - uDir * float(i) * 1.6).rgb * W[i];
  }
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uTexel;
uniform float uBloomStrength;
uniform float uSpeed;
uniform float uExposure;
uniform float uFxaa;
out vec4 o;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 sceneAt(vec2 uv) {
  if (uFxaa < 0.5) return texture(uScene, uv).rgb;
  // FXAA-lite: blend along the local edge when MSAA is not available.
  vec3 c = texture(uScene, uv).rgb;
  float lN = dot(texture(uScene, uv + vec2(0.0, uTexel.y)).rgb, vec3(0.3, 0.59, 0.11));
  float lS = dot(texture(uScene, uv - vec2(0.0, uTexel.y)).rgb, vec3(0.3, 0.59, 0.11));
  float lE = dot(texture(uScene, uv + vec2(uTexel.x, 0.0)).rgb, vec3(0.3, 0.59, 0.11));
  float lW = dot(texture(uScene, uv - vec2(uTexel.x, 0.0)).rgb, vec3(0.3, 0.59, 0.11));
  vec2 dir = vec2(lN - lS, lW - lE);
  if (length(dir) < 0.05) return c;
  dir = normalize(dir) * uTexel * 1.2;
  return (c + texture(uScene, uv + dir).rgb + texture(uScene, uv - dir).rgb) / 3.0;
}

void main() {
  vec2 fromCentre = vUv - 0.5;
  vec3 c = sceneAt(vUv);
  // Radial speed blur, strongest toward the edges of the screen.
  float blur = uSpeed * smoothstep(0.15, 0.7, length(fromCentre));
  if (blur > 0.001) {
    vec3 acc = c;
    for (int i = 1; i <= 6; i++) acc += texture(uScene, vUv - fromCentre * blur * float(i) * 0.012).rgb;
    c = acc / 7.0;
  }
  c += texture(uBloom, vUv).rgb * uBloomStrength;
  c = aces(c * uExposure);
  // Grade: shadows toward indigo, highlights toward ember, a touch more contrast.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += mix(vec3(0.02, 0.0, 0.05), vec3(0.04, 0.015, -0.03), smoothstep(0.2, 0.8, l));
  c = mix(vec3(l), c, 1.15);
  c = (c - 0.5) * 1.1 + 0.5;
  float v = smoothstep(0.82, 0.2, length(fromCentre * vec2(1.05, 1.0)));
  c *= mix(0.45, 1.0, v);
  o = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 1.05)), 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'post shader failed');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('post link failed');
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function texture(gl, w, h, fmt) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function targetFor(gl, tex) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fb;
}

export class PostFX {
  constructor(gl) {
    this.gl = gl;
    const float = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.fmt = float ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.hdr = Boolean(float);
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    this.bright = compile(gl, QUAD_VERT, BRIGHT_FRAG);
    this.blur = compile(gl, QUAD_VERT, BLUR_FRAG);
    this.composite = compile(gl, QUAD_VERT, COMPOSITE_FRAG);
    this.vao = gl.createVertexArray();
    this.w = 0;
    this.h = 0;
  }

  /** (Re)create the targets for a drawing-buffer size; throws if the driver refuses the framebuffers. */
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    this.sceneTex = texture(gl, w, h, this.fmt);
    this.sceneFb = targetFor(gl, this.sceneTex);
    this.msFb = null;
    if (this.samples > 1) {
      try {
        this.msFb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
        const color = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, color);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.fmt.internal, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
        const depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.msFb = null;
      } catch {
        this.msFb = null;
      }
    }
    if (!this.msFb) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFb);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('scene framebuffer incomplete');
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    this.bloomA = texture(gl, hw, hh, this.fmt);
    this.bloomB = texture(gl, hw, hh, this.fmt);
    this.bloomFbA = targetFor(gl, this.bloomA);
    this.bloomFbB = targetFor(gl, this.bloomB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Bind the framebuffer the 3D scene should be drawn into. */
  beginScene() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb || this.sceneFb);
    gl.viewport(0, 0, this.w, this.h);
  }

  pass(prog, fb, w, h, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Resolve, bloom and composite to the screen. speed 0..1 drives the radial blur. */
  endScene({ speed = 0, bloom = 0.9 } = {}) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    if (this.msFb) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFb);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    const hw = Math.max(1, this.w >> 1);
    const hh = Math.max(1, this.h >> 1);
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    this.pass(this.bright, this.bloomFbA, hw, hh, (u) => { bind(0, this.sceneTex); gl.uniform1i(u.uScene, 0); gl.uniform1f(u.uThreshold, this.hdr ? 0.62 : 0.55); });
    for (let i = 0; i < 2; i++) {
      this.pass(this.blur, this.bloomFbB, hw, hh, (u) => { bind(0, this.bloomA); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, (1 + i) / hw, 0); });
      this.pass(this.blur, this.bloomFbA, hw, hh, (u) => { bind(0, this.bloomB); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 0, (1 + i) / hh); });
    }
    this.pass(this.composite, null, this.w, this.h, (u) => {
      bind(0, this.sceneTex);
      bind(1, this.bloomA);
      gl.uniform1i(u.uScene, 0);
      gl.uniform1i(u.uBloom, 1);
      gl.uniform2f(u.uTexel, 1 / this.w, 1 / this.h);
      gl.uniform1f(u.uBloomStrength, bloom);
      gl.uniform1f(u.uSpeed, speed);
      gl.uniform1f(u.uExposure, 1.15);
      gl.uniform1f(u.uFxaa, this.msFb ? 0 : 1);
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
  }
}
