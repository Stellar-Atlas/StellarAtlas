const documentationLinks = [
	{ href: '/', label: 'Graph' },
	{ href: '/explorer', label: 'Explorer' },
	{ href: '/overview', label: 'Overview' },
	{ href: '/nodes', label: 'Nodes' },
	{ href: '/organizations', label: 'Organizations' },
	{ href: '/status', label: 'Status' },
	{ href: '/archives', label: 'Archives' },
	{ href: '/docs', label: 'API' }
] as const;

const navigationLinks = documentationLinks
	.map(
		({ href, label }) =>
			`<a class="sa-docs-nav-link" href="${href}">${label}</a>`
	)
	.join('');

const documentationShell = `
<style data-stellaratlas-docs-shell>
	.sa-docs-header {
		background: #101417;
		border-bottom: 1px solid #2b373b;
		color: #e8f0ef;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		position: sticky;
		top: 0;
		z-index: 1000;
	}
	.sa-docs-header-inner {
		align-items: center;
		display: flex;
		gap: 18px;
		inline-size: min(1440px, calc(100% - 48px));
		margin: 0 auto;
		min-block-size: 68px;
	}
	.sa-docs-brand {
		align-items: center;
		color: #e8f0ef;
		display: inline-flex;
		font-size: 1.25rem;
		font-weight: 800;
		gap: 10px;
		text-decoration: none;
		white-space: nowrap;
	}
	.sa-docs-brand-mark {
		align-items: center;
		background: #79c7c0;
		border-radius: 6px;
		color: #10201e;
		display: inline-flex;
		font-size: 0.8rem;
		inline-size: 30px;
		justify-content: center;
		block-size: 30px;
	}
	.sa-docs-nav {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.sa-docs-nav-link,
	.sa-docs-current {
		border-radius: 6px;
		color: #aebbb9;
		font-size: 0.95rem;
		font-weight: 700;
		padding: 8px 10px;
		text-decoration: none;
	}
	.sa-docs-nav-link:hover,
	.sa-docs-current {
		background: #1d3234;
		color: #79c7c0;
	}
	.sa-docs-current {
		margin-inline-start: auto;
		white-space: nowrap;
	}
	.sa-docs-menu {
		display: none;
		margin-inline-start: auto;
		position: relative;
	}
	.sa-docs-menu summary {
		background: #182023;
		border: 1px solid #334247;
		border-radius: 6px;
		color: #e8f0ef;
		cursor: pointer;
		font-weight: 800;
		list-style: none;
		padding: 9px 12px;
	}
	.sa-docs-menu summary::-webkit-details-marker {
		display: none;
	}
	.sa-docs-menu-nav {
		background: #182023;
		border: 1px solid #334247;
		border-radius: 8px;
		box-shadow: 0 16px 40px rgb(0 0 0 / 35%);
		display: grid;
		gap: 4px;
		inline-size: min(280px, calc(100vw - 32px));
		padding: 8px;
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
	}
	@media (max-width: 980px) {
		.sa-docs-header-inner {
			inline-size: min(100% - 32px, 1440px);
		}
		.sa-docs-nav,
		.sa-docs-current {
			display: none;
		}
		.sa-docs-menu {
			display: block;
		}
	}
</style>
<header class="sa-docs-header">
	<div class="sa-docs-header-inner">
		<a class="sa-docs-brand" href="/">
			<span class="sa-docs-brand-mark">SA</span>
			<span>StellarAtlas</span>
		</a>
		<nav aria-label="Primary navigation" class="sa-docs-nav">
			${navigationLinks}
		</nav>
		<span aria-current="page" class="sa-docs-current">Interactive API</span>
		<details class="sa-docs-menu">
			<summary>Menu</summary>
			<nav aria-label="Mobile primary navigation" class="sa-docs-menu-nav">
				${navigationLinks}
				<a aria-current="page" class="sa-docs-current" href="/api-docs?view=swagger">Interactive API</a>
			</nav>
		</details>
	</div>
</header>
`;

export function rewriteSwaggerHtml(body: string, version: string): string {
	let rewritten = body
		.replaceAll('href="./', 'href="/api-docs/')
		.replaceAll('src="./', 'src="/api-docs/')
		.replace(
			'src="/api-docs/swagger-ui-init.js"',
			`src="/api-docs/swagger-ui-init.js?v=${encodeURIComponent(version)}"`
		);

	if (!rewritten.includes('data-stellaratlas-docs-shell')) {
		rewritten = rewritten.replace(
			/<body([^>]*)>/i,
			`<body$1>${documentationShell}`
		);
	}

	return rewritten;
}
