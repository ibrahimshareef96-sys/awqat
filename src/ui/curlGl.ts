/**
 * The turning page, drawn on the graphics chip: a fine mesh of the page bent round the fold in the vertex shader, with the
 * page's picture on it. The page's words are not touched while it turns, nor is anything laid out or painted, so a frame
 * costs a few numbers and one draw, whatever is on the page. The light falls across the bend, and the fold and the leaf's
 * free edge throw a soft shadow on what lies under them. Its shape is curlMath.ts foldPoint, in GLSL.
 */
import type { CurlShape } from "./curlMath.ts";

const VERTEX = `
attribute vec2 a_uv;
uniform vec2 u_view;
uniform vec2 u_page;
uniform float u_hinge;
uniform vec4 u_fold; // axis, radius, sin, cos
varying vec2 v_uv;
varying float v_phase;
varying vec2 v_fold;
const float PI = 3.14159265;
void main() {
  float s = a_uv.x * u_page.x;
  float t = (a_uv.y - 0.5) * u_page.y;
  float u = s * u_fold.w + t * u_fold.z;
  float v = -s * u_fold.z + t * u_fold.w;
  float past = u - u_fold.x;
  float along = u;
  float height = 0.0;
  float phase = 0.0;
  if (past > 0.0) {
    if (u_fold.y < 0.001 || past >= PI * u_fold.y) {
      along = u_fold.x - (past - PI * u_fold.y);
      height = 2.0 * u_fold.y;
      phase = PI;
    } else {
      phase = past / u_fold.y;
      along = u_fold.x + u_fold.y * sin(phase);
      height = u_fold.y * (1.0 - cos(phase));
    }
  }
  float s2 = along * u_fold.w - v * u_fold.z;
  float t2 = along * u_fold.z + v * u_fold.w;
  // Lifted towards the eye a little, so the bend has depth without any of it reading as a tilt of the whole page.
  float w = 1.0 - height / (u_page.x * 8.0);
  vec2 clip = vec2((u_hinge - s2) / u_view.x * 2.0 - 1.0, 1.0 - (u_page.y * 0.5 + t2) / u_view.y * 2.0);
  // The bend's height keeps the sheet that has folded over on top, even as the fold closes up at the spine.
  float depth = -(height / u_page.x + phase * 0.01);
  gl_Position = vec4(clip * w, depth * w, w);
  v_uv = a_uv;
  v_phase = phase;
  v_fold = vec2(u, v);
}`;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_front;
uniform sampler2D u_back;
uniform float u_ownBack;
uniform float u_night;
uniform vec3 u_paper;
uniform vec2 u_edge; // where the free edge has come to at the fold's middle, and how it leans
uniform float u_lift;
uniform float u_strength;
varying vec2 v_uv;
varying float v_phase;
varying vec2 v_fold;
void main() {
  float bend = sin(v_phase);
  vec3 color;
  if (gl_FrontFacing) {
    color = texture2D(u_front, vec2(1.0 - v_uv.x, v_uv.y)).rgb;
    // Darkening towards the crest of the fold, and the shadow the folded part throws past its free edge.
    float edge = u_edge.x - v_fold.y * u_edge.y;
    float over = v_phase == 0.0 && v_fold.x < edge ? exp((v_fold.x - edge) / u_lift) * u_strength : 0.0;
    color *= 1.0 - bend * bend * mix(0.34, 0.5, u_night) - over;
    color += bend * mix(0.0, 0.05, u_night);
  } else {
    vec3 page = u_ownBack > 0.5 ? mix(texture2D(u_front, vec2(1.0 - v_uv.x, v_uv.y)).rgb, u_paper, mix(0.86, 0.9, u_night))
      : texture2D(u_back, v_uv).rgb;
    // Bright on the shoulder of the fold, settling back to the page's own colour as it lies flat.
    float shoulder = pow(bend, 3.0);
    color = page * (1.0 - bend * bend * mix(0.16, 0.3, u_night));
    color += shoulder * mix(0.07, 0.09, u_night);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const SHADOW_VERTEX = `
attribute vec2 a_uv;
uniform vec2 u_view;
uniform vec2 u_page;
uniform float u_hinge;
uniform vec4 u_fold;
varying vec2 v_fold;
void main() {
  vec2 at = a_uv * u_view;
  float s = u_hinge - at.x;
  float t = at.y - u_page.y * 0.5;
  v_fold = vec2(s * u_fold.w + t * u_fold.z, -s * u_fold.z + t * u_fold.w);
  gl_Position = vec4(a_uv.x * 2.0 - 1.0, 1.0 - a_uv.y * 2.0, 0.99, 1.0);
}`;

const SHADOW_FRAGMENT = `
precision highp float;
uniform float u_crest;
uniform vec2 u_edge;
uniform float u_lift;
uniform float u_strength;
varying vec2 v_fold;
void main() {
  // Thrown away from the fold on to the page it uncovers, and past the free edge on to whatever the leaf comes over.
  float edge = u_edge.x - v_fold.y * u_edge.y;
  float beyond = v_fold.x > u_crest ? exp((u_crest - v_fold.x) / u_lift) : 0.0;
  float ahead = v_fold.x < edge ? exp((v_fold.x - edge) / u_lift) * 0.8 : 0.0;
  float alpha = max(beyond, ahead) * u_strength;
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}`;

const ACROSS = 72;
const DOWN = 28;

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, "a_uv");
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function meshBuffers(gl: WebGLRenderingContext): { vertices: WebGLBuffer | null; indices: WebGLBuffer | null; count: number } {
  const points: number[] = [];
  for (let y = 0; y <= DOWN; y++) for (let x = 0; x <= ACROSS; x++) points.push(x / ACROSS, y / DOWN);
  const triangles: number[] = [];
  for (let y = 0; y < DOWN; y++) {
    for (let x = 0; x < ACROSS; x++) {
      const at = y * (ACROSS + 1) + x;
      triangles.push(at, at + 1, at + ACROSS + 1, at + 1, at + ACROSS + 2, at + ACROSS + 1);
    }
  }
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(triangles), gl.STATIC_DRAW);
  return { vertices, indices, count: triangles.length };
}

export interface CurlFrame {
  front: WebGLTexture;
  /** The page on the leaf's back, or null: the back of the same paper, the page faintly through it. */
  back: WebGLTexture | null;
  shape: CurlShape;
  /** The whole view, in px. */
  view: { width: number; height: number };
  /** One page's width, in px. */
  pageWidth: number;
  /** The spine's x, in px. */
  hinge: number;
  progress: number;
  night: boolean;
}

export interface CurlGl {
  picture: (source: HTMLCanvasElement) => WebGLTexture | null;
  drop: (texture: WebGLTexture) => void;
  draw: (frame: CurlFrame) => void;
  clear: () => void;
}

const uniforms = (gl: WebGLRenderingContext, program: WebGLProgram, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<string, WebGLUniformLocation | null>;

/** Null where the chip's drawing is not to be had: the reader then keeps its plain sliding pages. */
export function createCurlGl(canvas: HTMLCanvasElement): CurlGl | null {
  const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false };
  const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const leaf = compile(gl, VERTEX, FRAGMENT);
  const shadow = compile(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
  if (!leaf || !shadow) return null;
  const mesh = meshBuffers(gl);
  const leafAt = uniforms(gl, leaf, ["u_view", "u_page", "u_hinge", "u_fold", "u_front", "u_back", "u_ownBack", "u_night", "u_paper", "u_edge", "u_lift", "u_strength"]);
  const shadowAt = uniforms(gl, shadow, ["u_view", "u_page", "u_hinge", "u_fold", "u_crest", "u_edge", "u_lift", "u_strength"]);
  const canMip = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  gl.clearColor(0, 0, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertices);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const picture = (source: HTMLCanvasElement): WebGLTexture | null => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (canMip) gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  };

  const clear = (): void => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };

  const draw = (f: CurlFrame): void => {
    const { axis, radius, theta } = f.shape;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const crest = axis + radius;
    // The free edge, folded back over the cylinder and read across the fold's lean: a line, as the shaders take it.
    const tan = sin / cos;
    const edge = 2 * axis + Math.PI * radius - f.pageWidth * cos - f.pageWidth * sin * tan;
    const lift = Math.max(8, f.pageWidth * 0.07);
    const strength = Math.sin(Math.PI * f.progress) * (f.night ? 0.5 : 0.22);
    clear();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(shadow);
    gl.uniform2f(shadowAt.u_view, f.view.width, f.view.height);
    gl.uniform2f(shadowAt.u_page, f.pageWidth, f.view.height);
    gl.uniform1f(shadowAt.u_hinge, f.hinge);
    gl.uniform4f(shadowAt.u_fold, axis, radius, sin, cos);
    gl.uniform1f(shadowAt.u_crest, crest);
    gl.uniform2f(shadowAt.u_edge, edge, tan);
    gl.uniform1f(shadowAt.u_lift, lift);
    gl.uniform1f(shadowAt.u_strength, strength);
    // The same mesh, spread over the whole view by the shadow's own vertex shader.
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(leaf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.front);
    gl.uniform1i(leafAt.u_front, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, f.back ?? f.front);
    gl.uniform1i(leafAt.u_back, 1);
    gl.uniform1f(leafAt.u_ownBack, f.back ? 0 : 1);
    gl.uniform1f(leafAt.u_night, f.night ? 1 : 0);
    // The paper and night grounds in mushaf.css.
    if (f.night) gl.uniform3f(leafAt.u_paper, 0.055, 0.055, 0.075);
    else gl.uniform3f(leafAt.u_paper, 0.957, 0.933, 0.882);
    gl.uniform2f(leafAt.u_view, f.view.width, f.view.height);
    gl.uniform2f(leafAt.u_page, f.pageWidth, f.view.height);
    gl.uniform1f(leafAt.u_hinge, f.hinge);
    gl.uniform4f(leafAt.u_fold, axis, radius, sin, cos);
    gl.uniform2f(leafAt.u_edge, edge, tan);
    gl.uniform1f(leafAt.u_lift, lift);
    gl.uniform1f(leafAt.u_strength, strength);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  };

  return { picture, drop: (texture) => gl.deleteTexture(texture), draw, clear };
}
