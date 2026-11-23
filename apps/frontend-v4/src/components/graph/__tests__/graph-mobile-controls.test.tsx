import { expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { GraphMobileControls } from '../graph-mobile-controls';

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!React.isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children as React.ReactNode)];
}
it('starts with analysis/feed collapsed and exposes named controls rather than a covering panel', () => {
	const html = renderToStaticMarkup(<GraphMobileControls panel={null} validators={73} organizations={23} ready={true}
		onPanelChange={() => undefined} onReset={() => undefined} onZoom={() => undefined} />);
	expect(html).toContain('73 validators');
	expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
	for (const label of ['Zoom in', 'Zoom out', 'Reset view']) expect(html).toContain('aria-label="' + label + '"');
	expect(html).toContain('swipe up/down to scroll');
});
it('opens one selected panel, restores the graph toggle and connects zoom/reset actions', () => {
	const change = jest.fn(), reset = jest.fn(), zoom = jest.fn();
	const controls = (panel: 'network' | 'feed' | null) => elements(GraphMobileControls({ panel, validators: 73,
		organizations: 23, ready: true, onPanelChange: change, onReset: reset, onZoom: zoom })).filter(node => node.type === 'button');
	(controls(null)[0]!.props.onClick as () => void)(); expect(change).toHaveBeenLastCalledWith('network');
	(controls('network')[0]!.props.onClick as () => void)(); expect(change).toHaveBeenLastCalledWith(null);
	(controls('network')[1]!.props.onClick as () => void)(); expect(change).toHaveBeenLastCalledWith('feed');
	(controls(null)[2]!.props.onClick as () => void)(); expect(zoom).toHaveBeenLastCalledWith(.8);
	(controls(null)[3]!.props.onClick as () => void)(); expect(zoom).toHaveBeenLastCalledWith(1.25);
	(controls(null)[4]!.props.onClick as () => void)(); expect(reset).toHaveBeenCalledTimes(1);
});
