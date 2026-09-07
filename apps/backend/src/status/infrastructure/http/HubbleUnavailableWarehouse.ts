import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

export class UnavailableHubbleWarehouse implements HubbleWarehouse {
	constructor(private readonly reason: string) {}
	async contractEvents(): Promise<never> {
		throw this.error();
	}
	async transactionDetail(): Promise<never> {
		throw this.error();
	}
	async classifyEventRows(): Promise<never> {
		throw this.error();
	}
	async transferActivity(): Promise<never> {
		throw this.error();
	}
	async accountTransactions(): Promise<never> {
		throw this.error();
	}
	async accountBalances(): Promise<never> {
		throw this.error();
	}
	async assetHolders(): Promise<never> {
		throw this.error();
	}
	async catalog(): Promise<never> {
		throw this.error();
	}
	async query(): Promise<never> {
		throw this.error();
	}
	private error(): HubbleWarehouseUnavailableError {
		return new HubbleWarehouseUnavailableError(this.reason);
	}
}
