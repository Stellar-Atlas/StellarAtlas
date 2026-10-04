import Ajv from 'ajv';
import { NodeV1Schema, type NodeStatisticsV1 } from '../../src/dto/node-v1.js';

const schema = NodeV1Schema.definitions?.NodeStatisticsV1;
if (schema === undefined) throw new Error('Node statistics schema missing');
const validate = new Ajv().compile(schema);
const statistics: NodeStatisticsV1 = {
	active30DaysPercentage: 0,
	validating30DaysPercentage: 0,
	overLoaded30DaysPercentage: 0,
	active24HoursPercentage: 0,
	validating24HoursPercentage: 0,
	overLoaded24HoursPercentage: 0,
	has30DayStats: false,
	has24HourStats: false
};

test('old node statistics remain valid without optional coverage', () => {
	expect(validate(statistics)).toBe(true);
});
test('positive sample coverage is additive for both availability windows', () => {
	expect(
		validate({
			...statistics,
			availability24HoursCoverage: { observedDays: 2, observedScans: 12 },
			availability30DaysCoverage: { observedDays: 25, observedScans: 150 }
		})
	).toBe(true);
});
test.each([
	{ observedDays: 0, observedScans: 1 },
	{ observedDays: 1, observedScans: -1 },
	{ observedDays: 1.5, observedScans: 2 },
	{ observedDays: 1 },
	null
])('invalid or incomplete coverage is rejected: %j', (coverage) => {
	expect(
		validate({ ...statistics, availability30DaysCoverage: coverage })
	).toBe(false);
});
