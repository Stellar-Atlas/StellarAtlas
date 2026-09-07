import { SaxesParser } from 'saxes';

/** Accept only a complete, non-paginated nginx-style autoindex, not an arbitrary HTML page. */
export function parseCompleteArchiveDirectoryIndex(
	body: string,
	pathname: string
): string[] | null {
	try {
		const parser = new SaxesParser({ xmlns: false });
		const stack: string[] = [];
		const counts = new Map<string, number>();
		const links: string[] = [];
		const titles: string[] = [];
		let text = '';
		let href = '';
		const allowed = new Set([
			'html',
			'html/head',
			'html/head/title',
			'html/body',
			'html/body/h1',
			'html/body/hr',
			'html/body/pre',
			'html/body/pre/a'
		]);
		const metadata =
			/^\s*(?:\d{2}-[A-Z][a-z]{2}-\d{4}\s+\d{2}:\d{2}\s+(?:\d+|-)\s*)?$/;
		parser.on('doctype', () => {
			throw new Error('Unsupported directory document');
		});
		parser.on('processinginstruction', () => {
			throw new Error('Unsupported directory instruction');
		});
		parser.on('comment', () => {
			throw new Error('Ambiguous directory comment');
		});
		parser.on('opentag', (tag) => {
			if (stack.join('/') === 'html/body/pre' && !metadata.test(text))
				throw new Error('Unexpected directory text');
			stack.push(tag.name);
			const path = stack.join('/');
			if (!allowed.has(path)) throw new Error('Not a plain complete directory');
			counts.set(path, (counts.get(path) ?? 0) + 1);
			if (tag.name === 'a') {
				if (
					Object.keys(tag.attributes).length !== 1 ||
					typeof tag.attributes.href !== 'string'
				)
					throw new Error('Invalid directory link');
				href = tag.attributes.href;
				if (
					links.length >= 257 ||
					(href !== '../' &&
						!/^(?:[0-9a-f]{2}\/|[a-z]+-[0-9a-f]{8}\.(?:json|xdr\.gz))$/.test(
							href
						))
				)
					throw new Error('Nonstandard or paginated directory link');
			} else if (Object.keys(tag.attributes).length)
				throw new Error('Unexpected directory attributes');
			text = '';
		});
		parser.on('text', (value) => {
			text += value;
		});
		parser.on('cdata', () => {
			throw new Error('Unexpected directory CDATA');
		});
		parser.on('closetag', () => {
			const name = stack.at(-1);
			if (name === 'a') {
				if (text !== href || links.includes(href))
					throw new Error('Ambiguous directory link');
				links.push(href);
			} else if (name === 'title' || name === 'h1') titles.push(text);
			else if (name === 'pre') {
				if (!metadata.test(text)) throw new Error('Incomplete directory rows');
			} else if (text.trim()) throw new Error('Unexpected directory content');
			stack.pop();
			text = '';
		});
		parser.on('error', (error) => {
			throw error;
		});
		parser.write(body.replaceAll('<hr>', '<hr/>')).close();
		if (
			stack.length ||
			links[0] !== '../' ||
			titles.length !== 2 ||
			titles.some((title) => title !== 'Index of ' + pathname)
		)
			return null;
		for (const path of allowed) {
			if (path.endsWith('/a')) continue;
			if (counts.get(path) !== (path.endsWith('/hr') ? 2 : 1)) return null;
		}
		return links.slice(1);
	} catch {
		return null;
	}
}
