export interface SnapshotBounds {
  startDate: Date;
  endDate: Date;
}

export type SnapshotDiffPayload<T extends SnapshotBounds> = Omit<
  T,
  keyof SnapshotBounds
>;

export function snapshotDiffPayload<T extends SnapshotBounds>(
  snapshot: T,
): SnapshotDiffPayload<T> {
  const { startDate, endDate, ...payload } = snapshot;
  void startDate;
  void endDate;

  return payload;
}
