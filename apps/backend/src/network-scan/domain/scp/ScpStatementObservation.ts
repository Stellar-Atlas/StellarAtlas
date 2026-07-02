import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
	ScpStatementObservation as CrawlerScpStatementObservation,
	StellarValueSummary
} from 'crawler';
import type {
	ScpStatementObservationV1,
	ScpStatementPledgesV1,
	ScpStatementTypeV1,
	ScpStatementValueV1
} from 'shared';

@Entity({ name: 'scp_statement_observation' })
@Index(['observedAt'])
@Index(['nodeId', 'slotIndex', 'statementType'])
@Index(['statementHash'], { unique: true })
export class ScpStatementObservation {
	@PrimaryGeneratedColumn()
	id?: number;

	@Column('text')
	nodeId: string;

	@Column('timestamptz')
	observedAt: Date;

	@Column('text')
	observedFromAddress: string;

	@Column('text')
	observedFromPeer: string;

	@Column('jsonb')
	pledges: ScpStatementPledgesV1;

	@Column('text')
	signature: string;

	@Column('numeric')
	slotIndex: string;

	@Column('text')
	statementHash: string;

	@Column('text')
	statementType: ScpStatementTypeV1;

	@Column('text')
	statementXdr: string;

	@Column('jsonb')
	values: ScpStatementValueV1[];

	constructor(
		observation: CrawlerScpStatementObservation | null = null
	) {
		if (observation === null) {
			this.nodeId = '';
			this.observedAt = new Date(0);
			this.observedFromAddress = '';
			this.observedFromPeer = '';
			this.pledges = { quorumSetHash: '', votes: [], accepted: [] };
			this.signature = '';
			this.slotIndex = '0';
			this.statementHash = '';
			this.statementType = 'nominate';
			this.statementXdr = '';
			this.values = [];
			return;
		}

		this.nodeId = observation.nodeId;
		this.observedAt = observation.observedAt;
		this.observedFromAddress = observation.observedFromAddress;
		this.observedFromPeer = observation.observedFromPeer;
		this.pledges = observation.pledges;
		this.signature = observation.signature;
		this.slotIndex = observation.slotIndex;
		this.statementHash = observation.statementHash;
		this.statementType = observation.statementType;
		this.statementXdr = observation.statementXdr;
		this.values = observation.values.map(mapStellarValueSummary);
	}

	toDTO(): ScpStatementObservationV1 {
		return {
			nodeId: this.nodeId,
			observedAt: this.observedAt.toISOString(),
			observedFromAddress: this.observedFromAddress,
			observedFromPeer: this.observedFromPeer,
			pledges: this.pledges,
			signature: this.signature,
			slotIndex: this.slotIndex,
			statementHash: this.statementHash,
			statementType: this.statementType,
			statementXdr: this.statementXdr,
			values: this.values
		};
	}
}

function mapStellarValueSummary(
	value: StellarValueSummary
): ScpStatementValueV1 {
	return {
		closeTime: value.closeTime,
		txSetHash: value.txSetHash,
		upgradeCount: value.upgradeCount,
		value: value.value
	};
}
