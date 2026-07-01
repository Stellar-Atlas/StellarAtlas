import 'reflect-metadata';
import { CategoryScanner } from '../../../CategoryScanner.js';
import { IHashCalculationPolicy } from './IHashCalculationPolicy.js';

export class FirstLedgerHashPolicy implements IHashCalculationPolicy {
	calculateHash() {
		return CategoryScanner.ZeroHash;
	}
}
