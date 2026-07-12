import Organization from '../Organization.js';
import { OrganizationTomlInfo } from './OrganizationTomlInfo.js';
import { NodeScan } from '../../node/scan/NodeScan.js';
import { err, ok, Result } from 'neverthrow';
import { OrganizationContactInformation } from '../OrganizationContactInformation.js';
import PublicKey from '../../node/PublicKey.js';
import Node from '../../node/Node.js';
import { OrganizationId } from '../OrganizationId.js';
import { OrganizationValidators } from '../OrganizationValidators.js';
import { ValidatorNotSEP20LinkedError } from './errors/ValidatorNotSEP20LinkedError.js';
import { TomlWithoutValidatorsError } from './errors/TomlWithoutValidatorsError.js';
import { WrongNodeScanForOrganizationScan } from './errors/WrongNodeScanForOrganizationScan.js';
import { InvalidOrganizationIdError } from './errors/InvalidOrganizationIdError.js';
import { OrganizationScanError } from './errors/OrganizationScanError.js';
import { TomlState } from './TomlState.js';
import { InvalidTomlStateError } from './errors/InvalidTomlStateError.js';
import { InvalidValidatorPublicKeyError } from './errors/InvalidValidatorPublicKeyError.js';
import { StrKey } from '@stellar/stellar-sdk';

type homeDomain = string;

export interface InvalidOrganizationTomlInfo {
	homeDomain: string;
	error: OrganizationScanError;
}

export class OrganizationScan {
	constructor(
		public readonly time: Date,
		public readonly organizations: Organization[],
		public readonly runId: string = organizationTomlRunId(time)
	) {}

	public updateWithTomlInfoCollection(
		organizationTomlInfoCollection: Map<homeDomain, OrganizationTomlInfo>,
		nodeScan: NodeScan,
		archivedOrganizations: Organization[] = []
	): Result<InvalidOrganizationTomlInfo[], OrganizationScanError> {
		if (!this.isSameTime(nodeScan)) {
			return err(
				new WrongNodeScanForOrganizationScan(this.time, nodeScan.time)
			);
		}

		const invalidOrganizationTomlInfos: InvalidOrganizationTomlInfo[] = [];

		organizationTomlInfoCollection.forEach(
			(organizationTomlInfo, homeDomain) => {
				const invalid = this.updateWithTomlInfo(
					homeDomain,
					archivedOrganizations,
					organizationTomlInfo,
					nodeScan
				);
				if (invalid) invalidOrganizationTomlInfos.push(invalid);
			}
		);

		this.updateValidatorsThatChangedHomeDomains(nodeScan);

		return ok(invalidOrganizationTomlInfos);
	}

	public calculateOrganizationAvailability(nodeScan: NodeScan) {
		this.organizations.forEach((organization) => {
			organization.updateAvailability(nodeScan.nodes, this.time, this.runId);
		});
	}

	public archiveOrganizationsWithNoActiveValidators(): Organization[] {
		return this.organizations
			.filter((organization) => organization.validators.value.length === 0)
			.map((organization) => {
				organization.archive(this.time);
				return organization;
			});
	}

	getAvailableOrganizationsCount(): number {
		return this.organizations.filter((organization) =>
			organization.isAvailable()
		).length;
	}

	private updateValidatorsThatChangedHomeDomains(nodeScan: NodeScan) {
		this.organizations.forEach((organization) => {
			const validators = organization.validators.value
				.map((publicKey) => {
					const node = nodeScan.getNodeByPublicKeyString(publicKey.value);
					if (node && node.homeDomain !== organization.homeDomain) {
						return null;
					}

					return publicKey;
				})
				.filter((publicKey): publicKey is PublicKey => !!publicKey);

			organization.updateValidators(
				new OrganizationValidators(validators),
				this.time
			);
		});
	}

	private unArchiveOrCreateOrganization(
		archivedOrganizations: Organization[],
		homeDomain: string
	): Organization | InvalidOrganizationTomlInfo {
		const archivedOrganization =
			archivedOrganizations.find(
				(organization) => organization.homeDomain === homeDomain
			) ?? null;

		if (archivedOrganization) {
			archivedOrganization.unArchive(this.time);
			return archivedOrganization;
		}

		const organizationId = OrganizationId.create(homeDomain);
		if (organizationId.isErr()) {
			return {
				homeDomain: homeDomain,
				error: new InvalidOrganizationIdError(homeDomain, organizationId.error)
			};
		}
		return Organization.create(organizationId.value, homeDomain, this.time);
	}

	private updateWithTomlInfo(
		homeDomain: string,
		archivedOrganizations: Organization[],
		organizationTomlInfo: OrganizationTomlInfo,
		nodeScan: NodeScan
	): InvalidOrganizationTomlInfo | undefined {
		let organization = this.getOrganizationByHomeDomain(homeDomain);

		if (!organization) {
			const organizationOrError = this.unArchiveOrCreateOrganization(
				archivedOrganizations,
				homeDomain
			);

			if (organizationOrError instanceof Organization)
				organization = organizationOrError;
			else return organizationOrError;

			this.organizations.push(organization);
		}
		const transportAuthoritative =
			organizationTomlInfo.fetchResult === 'success' &&
			organizationTomlInfo.authoritative !== false &&
			!organizationTomlInfo.warnings.includes(
				'TlsCertificateVerificationDisabled'
			);
		const validators =
			transportAuthoritative && organizationTomlInfo.state === TomlState.Ok
				? this.validateValidators(
						organization,
						organizationTomlInfo.validators,
						organizationTomlInfo.validatorSetValid,
						nodeScan
					)
				: null;
		const authoritative = validators?.isOk() === true;

		organization.recordTomlAttempt(
			organizationTomlInfo.fetchResult,
			organizationTomlInfo.state,
			organizationTomlInfo.warnings,
			this.time,
			organizationTomlInfo.stellarTomlText,
			authoritative,
			this.runId
		);
		if (organizationTomlInfo.fetchResult === 'success' && authoritative) {
			organization.updateStellarTomlText(
				organizationTomlInfo.stellarTomlText,
				this.time
			);
		}
		if (organizationTomlInfo.state !== TomlState.Ok) {
			return {
				homeDomain: homeDomain,
				error: new InvalidTomlStateError(homeDomain, organizationTomlInfo.state)
			};
		}
		if (
			organizationTomlInfo.fetchResult !== 'success' ||
			!transportAuthoritative
		) {
			return undefined;
		}
		if (validators === null) return undefined;
		if (validators.isErr()) {
			if (validators.error instanceof ValidatorNotSEP20LinkedError) {
				organization.updateTomlState(
					TomlState.ValidatorNotSEP20Linked,
					this.time
				);
			}
			if (validators.error instanceof TomlWithoutValidatorsError) {
				organization.updateTomlState(TomlState.EmptyValidatorsField, this.time);
			}
			if (validators.error instanceof InvalidValidatorPublicKeyError) {
				organization.updateTomlState(TomlState.Unknown, this.time);
			}
			return { homeDomain, error: validators.error };
		}

		this.updateOrganization(
			organization,
			organizationTomlInfo,
			validators.value
		);
	}

	private updateOrganization(
		organization: Organization,
		organizationTomlInfo: OrganizationTomlInfo,
		validators: OrganizationValidators
	): void {
		if (organizationTomlInfo.name)
			organization.updateName(organizationTomlInfo.name, this.time);
		if (organizationTomlInfo.description)
			organization.updateDescription(
				organizationTomlInfo.description,
				this.time
			);
		if (organizationTomlInfo.url)
			organization.updateUrl(organizationTomlInfo.url, this.time);
		if (organizationTomlInfo.horizonUrl)
			organization.updateHorizonUrl(organizationTomlInfo.horizonUrl, this.time);
		const contactInformation = OrganizationContactInformation.create({
			dba: organizationTomlInfo.dba,
			officialEmail: organizationTomlInfo.officialEmail,
			keybase: organizationTomlInfo.keybase,
			github: organizationTomlInfo.github,
			twitter: organizationTomlInfo.twitter,
			phoneNumber: organizationTomlInfo.phoneNumber,
			physicalAddress: organizationTomlInfo.physicalAddress
		});
		organization.updateContactInformation(contactInformation, this.time);

		organization.updateValidators(validators, this.time);
	}

	private validateValidators(
		organization: Organization,
		validators: string[],
		validatorSetValid: boolean,
		nodeScan: NodeScan
	): Result<
		OrganizationValidators,
		| InvalidValidatorPublicKeyError
		| ValidatorNotSEP20LinkedError
		| TomlWithoutValidatorsError
	> {
		if (!validatorSetValid) {
			return err(new InvalidValidatorPublicKeyError(organization.homeDomain));
		}
		if (validators.length === 0)
			return err(new TomlWithoutValidatorsError(organization.homeDomain));

		const publicKeys: PublicKey[] = [];
		const uniqueValidators = new Set<string>();
		for (const validator of validators) {
			if (
				!StrKey.isValidEd25519PublicKey(validator) ||
				uniqueValidators.has(validator)
			) {
				return err(new InvalidValidatorPublicKeyError(organization.homeDomain));
			}
			const publicKeyOrError = PublicKey.create(validator);
			if (publicKeyOrError.isErr()) {
				return err(new InvalidValidatorPublicKeyError(organization.homeDomain));
			}
			const publicKey = publicKeyOrError.value;
			publicKeys.push(publicKey);
			uniqueValidators.add(validator);
		}

		const validatorWithInvalidHomeDomain = publicKeys
			.map((publicKey) => nodeScan.getNodeByPublicKeyString(publicKey.value))
			.filter((node): node is Node => !!node)
			.find((node) => node.homeDomain !== organization.homeDomain);

		if (validatorWithInvalidHomeDomain)
			return err(
				new ValidatorNotSEP20LinkedError(
					organization.homeDomain,
					validatorWithInvalidHomeDomain.homeDomain,
					validatorWithInvalidHomeDomain.publicKey
				)
			);

		return ok(new OrganizationValidators(publicKeys));
	}

	private getOrganizationByHomeDomain(homeDomain: string): Organization | null {
		return (
			this.organizations.find(
				(organization) => organization.homeDomain === homeDomain
			) ?? null
		);
	}

	private isSameTime(nodeScan: NodeScan): boolean {
		return this.time.getTime() === nodeScan.time.getTime();
	}
}

function organizationTomlRunId(time: Date): string {
	if (Number.isNaN(time.getTime())) {
		throw new Error('Organization scan requires a valid observed time');
	}
	return `network-scan:${time.toISOString()}`;
}
