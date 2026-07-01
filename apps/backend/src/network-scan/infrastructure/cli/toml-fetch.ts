import Kernel from '../../../core/infrastructure/Kernel.js';
import { OrganizationTomlFetcher } from '../../domain/organization/scan/OrganizationTomlFetcher.js';
import { NodeTomlFetcher } from '../../domain/node/scan/NodeTomlFetcher.js';

main();

async function main() {
	const kernel = await Kernel.getInstance();
	const organizationTomlFetcher = kernel.container.get(OrganizationTomlFetcher);
	const nodeTomlFetcher = kernel.container.get(NodeTomlFetcher);

	const organizationResult =
		await organizationTomlFetcher.fetchOrganizationTomlInfoCollection([
			process.argv[2]
		]);

	console.log(organizationResult);

	const nodeResult = await nodeTomlFetcher.fetchNodeTomlInfoCollection([
		process.argv[2]
	]);

	console.log(nodeResult);
}
