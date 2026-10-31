// A server has no GPU. WebGL still has to work, as it does on every real computer a site expects: Mesa's software
// renderer (llvmpipe) behind ANGLE draws it. Pages are then told the graphics chip a Linux desktop of this kind really
// has, instead of "llvmpipe", which no visitor's browser reports. The values stay consistent with the Linux user agent.
import { existsSync } from "node:fs";

export interface GpuIdentity { vendor: string; renderer: string }

/** What an Intel UHD 630 (Coffee Lake GT2) on Mesa reports through ANGLE on Linux, the most common desktop. */
export const DEFAULT_GPU: GpuIdentity = {
  vendor: "Google Inc. (Intel)",
  renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)",
};

/** Software GL where Linux has no render node; NORDUS_BROWSER_SOFTWARE_GL=1 or 0 decides it either way. */
export function needsSoftwareGl(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): boolean {
  const named = env.NORDUS_BROWSER_SOFTWARE_GL?.trim();
  if (named === "1") return platform === "linux";
  if (named === "0") return false;
  return platform === "linux" && !exists("/dev/dri/renderD128");
}

export function softwareGlFlags(): string[] {
  return ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist"];
}

export function gpuIdentity(env: NodeJS.ProcessEnv): GpuIdentity {
  const renderer = env.NORDUS_BROWSER_GPU_RENDERER?.trim();
  const vendor = env.NORDUS_BROWSER_GPU_VENDOR?.trim();
  return renderer ? { vendor: vendor || DEFAULT_GPU.vendor, renderer } : DEFAULT_GPU;
}

/** Runs before any page script: WEBGL_debug_renderer_info answers with the chip above. The wrapper keeps the function's
 * own name, length and "[native code]" text, so the page cannot tell it was replaced. */
export function webglIdentityScript(gpu: GpuIdentity): string {
  return `(() => {
  const VENDOR = ${JSON.stringify(gpu.vendor)};
  const RENDERER = ${JSON.stringify(gpu.renderer)};
  const natives = new WeakMap();
  const nativeToString = Function.prototype.toString;
  const toString = new Proxy(nativeToString, { apply(target, self, args) { const own = natives.get(self); return own !== undefined ? own : Reflect.apply(target, self, args); } });
  Object.defineProperty(Function.prototype, "toString", { value: toString, writable: true, configurable: true, enumerable: false });
  natives.set(toString, "function toString() { [native code] }");
  const wrap = (proto) => {
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "getParameter");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    const patched = new Proxy(original, { apply(target, self, args) {
      const name = args[0];
      if (name === 0x9245) return VENDOR;
      if (name === 0x9246) return RENDERER;
      return Reflect.apply(target, self, args);
    } });
    natives.set(patched, "function getParameter() { [native code] }");
    Object.defineProperty(proto, "getParameter", { ...descriptor, value: patched });
  };
  wrap(globalThis.WebGLRenderingContext && WebGLRenderingContext.prototype);
  wrap(globalThis.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
})();`;
}
