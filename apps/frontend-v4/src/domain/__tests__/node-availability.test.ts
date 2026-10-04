import type { PublicNode } from '../../api/types';
import { nodeFixture } from '../../components/nodes/__tests__/node-detail-fixtures';
import {
	formatNode24HourActive,
	formatNode24HourValidating,
	formatNode30DayActive,
	formatNode30DayValidating
} from '../availability';

function measuredNode(
	overrides: Partial<PublicNode['statistics']> = {}
): PublicNode {
	const node = nodeFixture('measured', { active: true, isValidating: true });
	return {
		...node,
		statistics: {
			...node.statistics,
			has24HourStats: true,
			has30DayStats: true,
			active24HoursPercentage: 94.65,
			validating24HoursPercentage: 42.39,
			active30DaysPercentage: 42.39,
			validating30DaysPercentage: 0,
			availability24HoursCoverage: { observedDays: 2, observedScans: 144 },
			availability30DaysCoverage: { observedDays: 25, observedScans: 2991 },
			...overrides
		}
	};
}

describe('node availability among usable observations', () => {
	it('retains measured low availability after current recovery rather than calling it Collecting', () => {
		expect(formatNode30DayActive(measuredNode())).toEqual({
			value: '42.4%',
			tone: 'warning',
			detail: '25 observed days · monitoring gaps excluded'
		});
	});
	it('retains a genuine measured zero and its observed coverage', () => {
		expect(formatNode30DayValidating(measuredNode())).toEqual({
			value: '0.0%',
			tone: 'warning',
			detail: '25 observed days · monitoring gaps excluded'
		});
	});
	it('labels24h by observed scans without inflating percentages', () => {
		expect(formatNode24HourActive(measuredNode())).toEqual({
			value: '94.7%',
			tone: 'warning',
			detail: '144 observed scans · monitoring gaps excluded'
		});
		expect(formatNode24HourValidating(measuredNode()).value).toBe('42.4%');
	});
	it('never turns an unevaluated window into zero or perfect uptime', () => {
		const node = measuredNode({ has30DayStats: false, has24HourStats: false });
		expect(formatNode30DayActive(node).value).toBe('Collecting');
		expect(formatNode30DayValidating(node).value).toBe('Collecting');
		expect(formatNode24HourValidating(node).value).toBe('Validating now');
	});
	it('supports old payloads without pretending their coverage is known', () => {
		expect(
			formatNode30DayActive(
				measuredNode({ availability30DaysCoverage: undefined })
			).detail
		).toBeUndefined();
	});
});
