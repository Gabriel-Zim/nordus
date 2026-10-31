import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { DEFAULT_GPU, gpuIdentity, needsSoftwareGl, softwareGlFlags, webglIdentityScript } from "./gpu.ts";
import { launcherFlags } from "./wrapper.ts";

describe("software WebGL", () => {
  it("is for a Linux server with no render node, unless NORDUS_BROWSER_SOFTWARE_GL says otherwise", () => {
    expect(needsSoftwareGl("linux", {}, () => false)).toBe(true);
    expect(needsSoftwareGl("linux", {}, () => true)).toBe(false);
    expect(needsSoftwareGl("darwin", {}, () => false)).toBe(false);
    expect(needsSoftwareGl("linux", { NORDUS_BROWSER_SOFTWARE_GL: "1" }, () => true)).toBe(true);
    expect(needsSoftwareGl("linux", { NORDUS_BROWSER_SOFTWARE_GL: "0" }, () => false)).toBe(false);
  });

  it("puts Mesa's renderer behind ANGLE through the launcher, last on the command line", () => {
    const flags = launcherFlags({ chrome: "/c", userAgent: "UA", screen: { width: 1, height: 1 }, softwareGl: true }, "linux");
    expect(flags).toEqual(expect.arrayContaining(softwareGlFlags()));
    expect(launcherFlags({ chrome: "/c", userAgent: "UA", screen: { width: 1, height: 1 } }, "linux")).not.toContain("--use-gl=angle");
  });

  it("reports a plausible Linux chip, which a deployment can change", () => {
    expect(gpuIdentity({})).toEqual(DEFAULT_GPU);
    expect(DEFAULT_GPU.renderer).toMatch(/^ANGLE \(Intel, Mesa Intel\(R\) UHD Graphics 630 \(CFL GT2\), OpenGL 4\.6\)$/u);
    expect(gpuIdentity({ NORDUS_BROWSER_GPU_RENDERER: "ANGLE (AMD, Mesa X, OpenGL 4.6)" }).renderer).toBe("ANGLE (AMD, Mesa X, OpenGL 4.6)");
  });
});

describe("the WebGL identity script", () => {
  function page() {
    const getParameter = function getParameter(this: unknown, name: number) { return name === 0x9245 ? "Google Inc. (Mesa)" : name === 0x9246 ? "ANGLE (Mesa, llvmpipe)" : name; };
    class WebGLRenderingContext {}
    Object.defineProperty(WebGLRenderingContext.prototype, "getParameter", { value: getParameter, writable: true, configurable: true, enumerable: true });
    class WebGL2RenderingContext {}
    Object.defineProperty(WebGL2RenderingContext.prototype, "getParameter", { value: getParameter, writable: true, configurable: true, enumerable: true });
    const context: Record<string, unknown> = { WebGLRenderingContext, WebGL2RenderingContext, Object, Reflect, Proxy, WeakMap, Function };
    context.globalThis = context;
    (context as { originalName?: string }).originalName = getParameter.name;
    runInNewContext(webglIdentityScript(DEFAULT_GPU), context);
    return context as { originalName: string; WebGLRenderingContext: typeof WebGLRenderingContext; WebGL2RenderingContext: typeof WebGL2RenderingContext };
  }

  it("answers the unmasked vendor and renderer with the chip and everything else as before", () => {
    const { WebGLRenderingContext, WebGL2RenderingContext } = page();
    for (const Context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const gl = new Context() as unknown as { getParameter(name: number): unknown };
      expect(gl.getParameter(0x9245)).toBe(DEFAULT_GPU.vendor);
      expect(gl.getParameter(0x9246)).toBe(DEFAULT_GPU.renderer);
      expect(gl.getParameter(7)).toBe(7);
    }
  });

  it("keeps the function looking native", () => {
    const { WebGLRenderingContext, originalName } = page();
    const patched = (WebGLRenderingContext.prototype as unknown as { getParameter: unknown }).getParameter as unknown as (() => void) & { name: string };
    expect(Function.prototype.toString.call(patched)).toBe("function getParameter() { [native code] }");
    expect(patched.name).toBe(originalName);
    expect(Function.prototype.toString.call(Function.prototype.toString)).toBe("function toString() { [native code] }");
    expect(Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, "getParameter")).toMatchObject({ writable: true, configurable: true, enumerable: true });
  });
});
