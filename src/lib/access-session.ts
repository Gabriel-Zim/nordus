/** Whether a request that never reached Nordus was turned away by the
 * Cloudflare Access sign-in in front of it. When that sign-in expires, Access
 * answers same-origin requests with a redirect to its own page, which `fetch`
 * reports as a network failure; asked not to follow redirects, the same
 * request comes back as an opaque redirect instead. Nordus itself never
 * redirects /api/health, so a redirect there is Access. */
export async function accessSignInExpired(request: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await request("/api/health", { redirect: "manual", cache: "no-store", credentials: "same-origin" });
    return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}
