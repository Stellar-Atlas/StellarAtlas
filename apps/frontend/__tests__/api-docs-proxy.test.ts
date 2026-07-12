import { rewriteApiDocsHtml } from "../api-docs-proxy";

describe("rewriteApiDocsHtml", () => {
  it("versions the generated Swagger document behind the ingress proxy", () => {
    const html = [
      '<link href="./swagger-ui.css" rel="stylesheet">',
      '<script src="./swagger-ui-bundle.js"></script>',
      '<script src="./swagger-ui-init.js"></script>',
    ].join("");

    const rewritten = rewriteApiDocsHtml(html, "build 42");

    expect(rewritten).toContain(
      'src="/api-docs/swagger-ui-init.js?v=build%2042"',
    );
    expect(rewritten).toContain('href="/api-docs/swagger-ui.css"');
    expect(rewritten).toContain('src="/api-docs/swagger-ui-bundle.js"');
  });
});
