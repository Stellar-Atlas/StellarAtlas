import { QuorumSet } from "shared";

export interface NodeSnapshotForDelta {
  startDate: Date;
  endDate: Date;
  publicKey: string;
  ip: string | null;
  port: number | null;
  host: string | null;
  name: string | null;
  homeDomain: string | null;
  historyUrl: string | null;
  alias: string | null;
  isp: string | null;
  ledgerVersion: number | null;
  overlayVersion: number | null;
  overlayMinVersion: number | null;
  versionStr: string | null;
  countryCode: string | null;
  countryName: string | null;
  longitude: number | null;
  latitude: number | null;
  organizationId: string | null;
  quorumSet: QuorumSet;
  quorumSetHashKey: string | null;
}

export type NodeUpdateKey =
  | "latitude"
  | "longitude"
  | "quorumSet"
  | "ip"
  | "port"
  | "countryName"
  | "countryCode"
  | "host"
  | "name"
  | "homeDomain"
  | "historyUrl"
  | "alias"
  | "isp"
  | "ledgerVersion"
  | "overlayVersion"
  | "overlayMinVersion"
  | "versionStr"
  | "organizationId";

export const nodeUpdateKeys: readonly NodeUpdateKey[] = [
  "latitude",
  "longitude",
  "quorumSet",
  "ip",
  "port",
  "countryName",
  "countryCode",
  "host",
  "name",
  "homeDomain",
  "historyUrl",
  "alias",
  "isp",
  "ledgerVersion",
  "overlayVersion",
  "overlayMinVersion",
  "versionStr",
  "organizationId",
];

export function hasNodeUpdate(
  current: NodeSnapshotForDelta,
  previous: NodeSnapshotForDelta,
  key: NodeUpdateKey,
): boolean {
  if (key === "quorumSet") {
    return current.quorumSetHashKey !== previous.quorumSetHashKey;
  }

  return current[key] !== previous[key];
}

export function getNodeUpdateValue(
  snapshot: NodeSnapshotForDelta,
  key: NodeUpdateKey,
): string {
  if (key === "quorumSet") return "updated";

  const value = snapshot[key];
  if (value === null) return "";

  return String(value);
}
