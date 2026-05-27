import { useEffect, useRef } from "react";

/**
 * Full-bleed WebGL fragment shader painting a flowing warm-amber noise
 * field. Domain-warped FBM (a la Inigo Quilez) animated slowly, with a
 * subtle mouse parallax and a radial vignette so headline text sitting
 * on top stays legible.
 *
 * Failure modes are silent: if WebGL is unavailable, the canvas stays
 * transparent and the parent's background-color shows through. If the
 * user has prefers-reduced-motion enabled we render one static frame
 * and stop animating. Pauses when the tab is hidden.
 */

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Fragment shader. Two FBMs feed a third (domain warp), giving the
// characteristic "wormy plasma" look. Color ramp picks up the brand
// orange (#FF5C26) at peaks and falls to the page background at low n.
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

  // Slow drift + a very subtle mouse parallax. Multiplying the mouse
  // term by a small constant keeps it from sloshing the whole field
  // around violently.
  float t = u_time * 0.06;
  p += (u_mouse - 0.5) * 0.2;

  vec2 q = vec2(fbm(p + t),
                fbm(p + vec2(1.7, 9.2) - t));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(8.3, 2.8) + t * 0.85),
                fbm(p + 2.0 * q + vec2(2.6, 5.4) - t * 0.85));
  float n = fbm(p + 2.5 * r);

  // Page background — keep low values matching #030303 so the canvas
  // edges blend into the body.
  vec3 col = vec3(0.012);
  col = mix(col, vec3(0.18, 0.07, 0.02), smoothstep(0.0, 0.45, n));   // ember
  col = mix(col, vec3(1.0, 0.36, 0.15),  smoothstep(0.55, 0.82, n));  // primary #FF5C26
  col = mix(col, vec3(1.0, 0.70, 0.30),  smoothstep(0.82, 0.98, n));  // gold peaks

  // Radial vignette, biased slightly vertical so the headline sits
  // in the darkest pocket. mix(0.18, 1.05, ...) crushes the center
  // toward black and lifts the edges a touch above the source color.
  vec2 c = uv - 0.5;
  float dist = length(c * vec2(1.0, 1.4));
  col *= mix(0.18, 1.05, smoothstep(0.05, 0.65, dist));

  // Cheap film grain so flat regions feel alive instead of banded.
  float grain = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.022;
  col += grain;

  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error("Shader compile error:", gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

export function ShaderBackground({ className = "" }: { className?: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const gl = canvas.getContext("webgl", {
			antialias: false,
			alpha: true,
			premultipliedAlpha: false,
			powerPreference: "low-power",
		});
		if (!gl) return;

		const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
		if (!vs || !fs) return;

		const program = gl.createProgram();
		if (!program) return;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error("Program link error:", gl.getProgramInfoLog(program));
			return;
		}
		gl.useProgram(program);

		// Two triangles covering clip space.
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

		const posAttrib = gl.getAttribLocation(program, "a_pos");
		gl.enableVertexAttribArray(posAttrib);
		gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

		const uResolution = gl.getUniformLocation(program, "u_resolution");
		const uTime = gl.getUniformLocation(program, "u_time");
		const uMouse = gl.getUniformLocation(program, "u_mouse");

		let mouseX = 0.5;
		let mouseY = 0.5;
		let targetMouseX = 0.5;
		let targetMouseY = 0.5;

		// Cap render scale: full DPR on a 4K display burns GPU for no
		// perceptible win on a noise pattern. 1.5 is the sweet spot.
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

		function resize() {
			if (!canvas || !gl) return;
			const w = Math.floor(canvas.clientWidth * dpr);
			const h = Math.floor(canvas.clientHeight * dpr);
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
				gl.viewport(0, 0, w, h);
			}
		}

		function onMouseMove(e: PointerEvent) {
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			targetMouseX = (e.clientX - rect.left) / rect.width;
			targetMouseY = 1.0 - (e.clientY - rect.top) / rect.height;
		}

		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);
		window.addEventListener("pointermove", onMouseMove, { passive: true });

		const start = performance.now();
		let rafId = 0;
		let paused = document.hidden;

		function frame() {
			if (paused || !gl || !canvas) return;
			const t = (performance.now() - start) / 1000;
			// Critically damped follow on the mouse so flicks don't
			// snap the field around.
			mouseX += (targetMouseX - mouseX) * 0.05;
			mouseY += (targetMouseY - mouseY) * 0.05;

			gl.uniform2f(uResolution, canvas.width, canvas.height);
			gl.uniform1f(uTime, reducedMotion ? 0 : t);
			gl.uniform2f(uMouse, mouseX, mouseY);

			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			if (!reducedMotion) {
				rafId = requestAnimationFrame(frame);
			}
		}

		function onVisibility() {
			paused = document.hidden;
			if (!paused && !reducedMotion) {
				rafId = requestAnimationFrame(frame);
			} else {
				cancelAnimationFrame(rafId);
			}
		}
		document.addEventListener("visibilitychange", onVisibility);

		rafId = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(rafId);
			ro.disconnect();
			window.removeEventListener("pointermove", onMouseMove);
			document.removeEventListener("visibilitychange", onVisibility);
			gl.deleteBuffer(buffer);
			gl.deleteProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
		};
	}, []);

	return <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full ${className}`} />;
}
