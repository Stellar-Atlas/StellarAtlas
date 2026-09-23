import selectorParser from 'postcss-selector-parser';

const active = ':where(body:has(.developer-docs))';
const inside = ':where(.developer-docs)';
function hasRuleParent(node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (parent.type === 'rule') return true;
		if (parent.type === 'atrule' && /keyframes$/i.test(parent.name))
			return true;
	}
	return false;
}

/** Generated docs CSS only. Never register this in the application's PostCSS pipeline. */
export function scopeDocsCss() {
	return {
		postcssPlugin: 'stellaratlas-docs-scope',
		OnceExit(root) {
			const animations = new Map();
			root.walkAtRules(/keyframes$/i, (rule) => {
				if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(rule.params))
					throw new Error('Unsupported docs animation name');
				const original = rule.params;
				const scoped = 'stellaratlas-docs-' + original;
				animations.set(original, scoped);
				rule.params = scoped;
			});
			root.walkDecls((declaration) => {
				if (!/^(?:animation(?:-name)?|--animate-)/.test(declaration.prop))
					return;
				declaration.value = declaration.value.replace(
					/(?<![-\w])[a-zA-Z][a-zA-Z0-9_-]*(?![-\w])/g,
					(value) => animations.get(value) ?? value
				);
			});
			// Existing site CSS is unlayered; flatten this already-scoped, isolated build so
			// site-wide heading/button rules cannot override every library utility.
			root.walkAtRules('layer', (rule) =>
				rule.nodes ? rule.replaceWith(...rule.nodes) : rule.remove()
			);
			root.walkRules((rule) => {
				if (hasRuleParent(rule)) return;
				const variablesOnly = rule.nodes?.every(
					(node) => node.type !== 'decl' || node.prop.startsWith('--')
				);
				rule.selector = selectorParser((selectors) => {
					selectors.each((selector) => {
						const onlyRoot = [':root', ':host', 'body', 'html'].includes(
							selector.toString().trim()
						);
						if (onlyRoot) {
							// Tokens reach portals. A body background/color rule styles the docs, never the app shell.
							selector.replaceWith(
								...selectorParser().astSync(
									variablesOnly ? active + ', ' + inside : inside
								).nodes
							);
							return;
						}
						let hasClassOrId = false;
						selector.walkPseudos((node) => {
							if (node.value === ':root' || node.value === ':host')
								node.replaceWith(
									selectorParser.className({ value: 'developer-docs' })
								);
						});
						selector.walkTags((node) => {
							if (node.value === 'body' || node.value === 'html')
								node.replaceWith(
									selectorParser.className({ value: 'developer-docs' })
								);
						});
						selector.walkClasses((node) => {
							hasClassOrId = true;
							if (node.value === 'dark')
								node.replaceWith(
									selectorParser()
										.astSync(':is([data-theme="dark"], [data-theme="dark"] *)')
										.first.first.clone()
								);
						});
						selector.walkIds(() => {
							hasClassOrId = true;
						});
						selector.prepend(selectorParser.combinator({ value: ' ' }));
						selector.prepend(
							selectorParser()
								.astSync(hasClassOrId ? active : inside)
								.first.first.clone()
						);
					});
				}).processSync(rule.selector);
			});
		}
	};
}
