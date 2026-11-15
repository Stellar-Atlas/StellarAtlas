import { rewriteApiDocsHtml } from "../api-docs-proxy";
import { compatibilityRedirect, configuredProxyOrigin, proxyInactivityMs, proxyLocation, proxyRequestOptions } from "../proxy-transport";

describe("legacy proxy target boundary", () => {
  const origin = configuredProxyOrigin("http://127.0.0.1:3104");

  it.each(["//localhost:8123/", "/\\localhost/", "/%2flocalhost/", "/%252flocalhost/", "/%255clocalhost/", "/bad%0d%0aheader", "/bad%", "/bad\u0000path"])(
    "rejects malformed or ambiguous origin-form %s", (path) => {
      expect(() => proxyRequestOptions(origin, path)).toThrow();
    },
  );

  it("keeps native authority fixed and legitimate paths/queries intact", () => {
    const path = "/v1/history-scan/https%3A%2F%2Farchive.example?at=2026-11-11&next=https%3A%2F%2Fexample.org";
    expect(proxyRequestOptions(origin, path)).toEqual({ protocol: "http:", hostname: "127.0.0.1", port: "3104", path });
    const signedArchive = "https://archive.example/bucket%2Fname?X-Amz-Signature=abc%2Fdef&X-Amz-Credential=user%2Fdate";
    const signedPath = `/v1/history-scan/${encodeURIComponent(signedArchive)}`;
    expect(proxyRequestOptions(origin, signedPath).path).toBe(signedPath);
    expect(proxyInactivityMs).toBe(300_000);
    expect(compatibilityRedirect("/new-ui/nodes?view=graph")).toBe("/./nodes?view=graph");
    expect(compatibilityRedirect("/new-ui?view=graph")).toBe("/./?view=graph");
    expect(compatibilityRedirect("/new-ui")).toBe("/./");
    for (const [input, expected] of [
      ["/new-ui/nodes?view=graph", "/nodes?view=graph"],
      ["/new-ui?view=graph", "/?view=graph"],
      ["/new-ui", "/"],
      ["/new-ui/v1/archive%2Fid?signature=abc%2Fdef", "/v1/archive%2Fid?signature=abc%2Fdef"],
    ]) {
      const target = new URL(compatibilityRedirect(input), "https://www.stellaratlas.io/new-ui/");
      expect(target.origin).toBe("https://www.stellaratlas.io");
      expect(target.pathname + target.search).toBe(expected);
    }
  });

  it("refuses external compatibility and upstream redirects", () => {
    expect(() => compatibilityRedirect("/new-ui//attacker.invalid/")).toThrow();
    expect(() => compatibilityRedirect("/new-ui/\\attacker.invalid/")).toThrow();
    expect(() => proxyLocation("//attacker.invalid/", origin, "/nodes")).toThrow();
    expect(() => proxyLocation("http://127.0.0.1:8123/", origin, "/nodes")).toThrow();
    expect(proxyLocation("http://127.0.0.1:3104/nodes?view=list#top", origin, "/")).toBe("/nodes?view=list#top");
    expect(proxyLocation("next?view=list", origin, "/nodes/")).toBe("/nodes/next?view=list");
  });
});

describe("rewriteApiDocsHtml", () => {
  it("routes Swagger assets locally and versions the generated API document", () => {
    const html = [
      "<body>",
      '<link href="./swagger-ui.css" rel="stylesheet">',
      '<script src="./swagger-ui-bundle.js"></script>',
      '<script src="./swagger-ui-init.js"></script>',
      "</body>",
    ].join("");

    const rewritten = rewriteApiDocsHtml(html, "build 42");

    expect(rewritten).toContain(
      'src="/api-docs/swagger-ui-init.js?v=build%2042"',
    );
    expect(rewritten).toContain('href="/api-docs/swagger-ui.css"');
    expect(rewritten).toContain('src="/api-docs/swagger-ui-bundle.js"');
  });

  it("adds the StellarAtlas desktop and mobile navigation once", () => {
    const rewritten = rewriteApiDocsHtml("<html><body></body></html>", "v1");
    const rewrittenAgain = rewriteApiDocsHtml(rewritten, "v2");

    expect(rewritten).toContain("data-stellaratlas-docs-shell");
    expect(rewritten).toContain('aria-label="Primary navigation"');
    expect(rewritten).toContain('aria-label="Mobile primary navigation"');
    expect(rewritten).toContain('href="/organizations"');
    expect(rewritten).toContain("Interactive API");
    expect(rewrittenAgain.match(/data-stellaratlas-docs-shell/g)).toHaveLength(
      1,
    );
  });
});
