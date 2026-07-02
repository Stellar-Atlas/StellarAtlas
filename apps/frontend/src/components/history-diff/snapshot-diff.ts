export interface SnapshotBounds {
  startDate: Date;
  endDate: Date;
}

export type SnapshotDiffPayload<T extends SnapshotBounds> = Omit<
  T,
  keyof SnapshotBounds
> & {
  startDate: string;
  endDate: string;
};

export function snapshotDiffPayload<T extends SnapshotBounds>(
  snapshot: T,
): SnapshotDiffPayload<T> {
  return {
    ...snapshot,
    startDate: snapshot.startDate.toISOString(),
    endDate: snapshot.endDate.toISOString(),
  };
}
