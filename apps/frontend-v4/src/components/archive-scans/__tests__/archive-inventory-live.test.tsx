import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveInventoryLive } from '../archive-inventory-live';

describe('archive inventory cold-start failure', () => {
	it('renders a useful fallback without inventing successful or zero-failure data', () => {
		const html = renderToStaticMarkup(
			<ArchiveInventoryLive initialSnapshot={null} />
		);
		expect(html).toContain('Archive data is temporarily unavailable');
		expect(html).toContain('Retry archive updates');
		expect(html).not.toContain('Network API unavailable');
		expect(html).not.toContain('Minified React error');
		expect(html).not.toContain('0 remote failures');
	});
});
