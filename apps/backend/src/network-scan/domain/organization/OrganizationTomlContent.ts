import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'organization_toml_content' })
@Check('CHK_organization_toml_content_hash', `"hash" ~ '^[0-9a-f]{64}$'`)
export class OrganizationTomlContent {
	@PrimaryColumn('char', { length: 64 })
	readonly hash!: string;

	@Column('integer')
	readonly byteLength!: number;

	@Column('text')
	readonly content!: string;

	@Column('timestamptz', { default: () => 'now()' })
	readonly createdAt!: Date;
}
