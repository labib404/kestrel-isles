// WebGL2 renderer: compiles the shaders, uploads meshes once, and draws a frame — sky, solid geometry,
// the sea (with the terrain's heightmap for shore foam), soft cloud billboards sorted far to near, then
// translucent pieces — into the post-processing chain (HDR, bloom, tone mapping) when it is available.

import { CLOUD_FRAG, CLOUD_VERT, LIT_FRAG, LIT_VERT, SEA_FRAG, SKY_FRAG, SKY_VERT } from './shaders.js';
import { dot, normalize } from './math.js';
import { PostFX } from './post.js';

// A low ember sun in the west-north-west, and a violet storm haze.
export const SUN = normalize([-0.82, 0.13, -0.42]);
export const FOG = [0.22, 0.13, 0.27];

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
  return s;
}

function program(gl, vs, fs, attribs = ['aPos', 'aNrm', 'aCol']) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

/** Uniforms every world shader shares: camera, sun, fog, time, lightning. */
function sceneUniforms(gl, u, r) {
  gl.uniformMatrix4fv(u.uVP, false, r.cam.vp);
  gl.uniform3fv(u.uSun, SUN);
  gl.uniform3fv(u.uCam, r.cam.eye);
  gl.uniform3fv(u.uFog, FOG);
  gl.uniform1f(u.uFogDensity, r.cam.fogDensity);
  gl.uniform1f(u.uTime, r.time);
  gl.uniform1f(u.uFlash, r.flash);
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This game needs WebGL2, which this browser has turned off.');
    this.gl = gl;
    this.canvas = canvas;
    // HDR + bloom + tone mapping when the driver allows it; plain rendering otherwise.
    try {
      this.post = new PostFX(gl);
    } catch {
      this.post = null;
    }
    this.lit = program(gl, LIT_VERT, LIT_FRAG);
    this.sea = program(gl, LIT_VERT, SEA_FRAG);
    this.sky = program(gl, SKY_VERT, SKY_FRAG);
    this.cloud = program(gl, CLOUD_VERT, CLOUD_FRAG, ['aCentre', 'aCorner', 'aShade']);
    this.skyVao = gl.createVertexArray();
    this.cloudVao = gl.createVertexArray();
    this.cloudBuf = gl.createBuffer();
    gl.bindVertexArray(this.cloudVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
    }
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.time = 0;
    this.flash = 0; // lightning brightness, 0..1, set by the weather each frame
  }

  /** Upload a mesh ({pos, nrm, col} arrays, optional idx) and return a handle for draw(). */
  mesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [data.pos, data.nrm, data.col].forEach((arr, loc) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr instanceof Float32Array ? arr : new Float32Array(arr), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    });
    let count = data.pos.length / 3;
    let indexed = false;
    if (data.idx) {
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.idx, gl.STATIC_DRAW);
      count = data.idx.length;
      indexed = true;
    }
    gl.bindVertexArray(null);
    return { vao, count, indexed };
  }

  /** The terrain's heights as a texture, so the sea knows how shallow it is (shore foam). */
  setHeightmap(heights, side, worldSize) {
    const gl = this.gl;
    this.heightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, side, side, 0, gl.RED, gl.FLOAT, heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.worldSize = worldSize;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    if (this.post) {
      try {
        this.post.resize(w, h);
      } catch {
        this.post = null;
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      }
    }
    return w / h;
  }

  /** Clear and draw the sky for a camera ({vp, invVP, view, eye, fogDensity}). */
  begin(cam) {
    const gl = this.gl;
    this.cam = cam;
    if (this.post) this.post.beginScene();
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    gl.uniformMatrix4fv(this.sky.u.uInvVP, false, cam.invVP);
    gl.uniform3fv(this.sky.u.uSun, SUN);
    gl.uniform3fv(this.sky.u.uFog, FOG);
    gl.uniform1f(this.sky.u.uFlash, this.flash);
    gl.uniform1f(this.sky.u.uTime, this.time);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.useProgram(this.lit.p);
    sceneUniforms(gl, this.lit.u, this);
  }

  /** Draw one mesh. opts: emissive 0..1, alpha (blends when under 1), terrain, tint [r,g,b]. */
  draw(handle, model, opts = {}) {
    const gl = this.gl;
    const u = this.lit.u;
    const alpha = opts.alpha ?? 1;
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform1f(u.uEmissive, opts.emissive ?? 0);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uTerrain, opts.terrain ? 1 : 0);
    gl.uniform3fv(u.uTint, opts.tint ?? [1, 1, 1]);
    if (alpha < 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    gl.bindVertexArray(handle.vao);
    if (handle.indexed) gl.drawElements(gl.TRIANGLES, handle.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, handle.count);
    if (alpha < 1) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }

  /** The sea plane with its own shader; returns to the lit shader afterwards. */
  drawSea(handle, model) {
    const gl = this.gl;
    gl.useProgram(this.sea.p);
    sceneUniforms(gl, this.sea.u, this);
    gl.uniformMatrix4fv(this.sea.u.uModel, false, model);
    gl.uniform1f(this.sea.u.uWorldSize, this.worldSize || 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex || null);
    gl.uniform1i(this.sea.u.uHeight, 0);
    gl.bindVertexArray(handle.vao);
    gl.drawArrays(gl.TRIANGLES, 0, handle.count);
    gl.useProgram(this.lit.p);
  }

  /** Soft cloud billboards [{pos, size, shade, seed, alpha}], sorted far to near and blended. */
  drawClouds(sprites) {
    const gl = this.gl;
    const v = this.cam.view;
    const right = [v[0], v[4], v[8]];
    const up = [v[1], v[5], v[9]];
    const eye = this.cam.eye;
    const order = sprites.map((s) => ({ s, d: (s.pos[0] - eye[0]) ** 2 + (s.pos[1] - eye[1]) ** 2 + (s.pos[2] - eye[2]) ** 2 })).sort((a, b) => b.d - a.d);
    const data = new Float32Array(order.length * 6 * 9);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    let k = 0;
    for (const { s } of order) {
      for (const [cx, cy] of corners) {
        data.set([s.pos[0], s.pos[1], s.pos[2], cx, cy, s.size, s.shade, s.seed, s.alpha], k);
        k += 9;
      }
    }
    gl.useProgram(this.cloud.p);
    sceneUniforms(gl, this.cloud.u, this);
    gl.uniform3fv(this.cloud.u.uRight, right);
    gl.uniform3fv(this.cloud.u.uUp, up);
    const sx = dot(SUN, right);
    const sy = dot(SUN, up);
    const l = Math.hypot(sx, sy) || 1;
    gl.uniform2f(this.cloud.u.uSunScreen, sx / l, sy / l);
    gl.bindVertexArray(this.cloudVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, order.length * 6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(this.lit.p);
  }

  /** Finish the frame: post-process to the screen (bloom, tone map, grade, speed blur). */
  end(opts) {
    if (this.post) this.post.endScene(opts);
  }
}
