/** Indexed heap: updates/deletes do not retain stale tombstones indefinitely. */
export class ArchiveBrokerIndexedHeap<T extends { readonly remoteId: string }> {
	private readonly nodes: T[] = [];
	private readonly positions = new Map<string, number>();
	constructor(private readonly compare: (left: T, right: T) => number) {}
	get size(): number {
		return this.nodes.length;
	}
	peek(): T | undefined {
		return this.nodes[0];
	}
	clear(): void {
		this.nodes.length = 0;
		this.positions.clear();
	}
	upsert(value: T): void {
		this.remove(value.remoteId);
		this.positions.set(value.remoteId, this.nodes.length);
		this.nodes.push(value);
		this.up(this.nodes.length - 1);
	}
	remove(id: string): T | undefined {
		const index = this.positions.get(id);
		if (index === undefined) return undefined;
		const removed = this.nodes[index]!;
		const last = this.nodes.pop()!;
		this.positions.delete(id);
		if (index < this.nodes.length) {
			this.nodes[index] = last;
			this.positions.set(last.remoteId, index);
			this.down(this.up(index));
		}
		return removed;
	}
	pop(): T | undefined {
		const first = this.peek();
		return first === undefined ? undefined : this.remove(first.remoteId);
	}
	/** Enumerates only the requested prefix without dequeuing authoritative data. */
	first(limit: number): T[] {
		if (limit < 1 || this.nodes.length === 0) return [];
		const frontier = new ArchiveBrokerIndexedHeap<{
			remoteId: string;
			index: number;
		}>((a, b) => this.compare(this.nodes[a.index]!, this.nodes[b.index]!));
		frontier.upsert({ remoteId: '0', index: 0 });
		const result: T[] = [];
		while (result.length < limit) {
			const next = frontier.pop();
			if (!next) break;
			result.push(this.nodes[next.index]!);
			for (const index of [next.index * 2 + 1, next.index * 2 + 2]) {
				if (index < this.nodes.length)
					frontier.upsert({ remoteId: String(index), index });
			}
		}
		return result;
	}
	private swap(a: number, b: number): void {
		[this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
		this.positions.set(this.nodes[a]!.remoteId, a);
		this.positions.set(this.nodes[b]!.remoteId, b);
	}
	private up(start: number): number {
		let index = start;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (this.compare(this.nodes[parent]!, this.nodes[index]!) <= 0) break;
			this.swap(parent, index);
			index = parent;
		}
		return index;
	}
	private down(start: number): void {
		let index = start;
		while (index * 2 + 1 < this.nodes.length) {
			const left = index * 2 + 1,
				right = left + 1;
			const child =
				right < this.nodes.length &&
				this.compare(this.nodes[right]!, this.nodes[left]!) < 0
					? right
					: left;
			if (this.compare(this.nodes[index]!, this.nodes[child]!) <= 0) break;
			this.swap(child, index);
			index = child;
		}
	}
}
