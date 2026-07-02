import 'reflect-metadata';
import { CategoryScanner } from '@domain/scanner/CategoryScanner.js';
import { IHashCalculationPolicy } from './IHashCalculationPolicy.js';

export class FirstLedgerHashPolicy implements IHashCalculationPolicy {
	calculateHash() {
		return CategoryScanner.ZeroHash;
	}
}
