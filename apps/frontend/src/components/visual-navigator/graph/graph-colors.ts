const organizationPalette = [
  "#2f80ed",
  "#27ae60",
  "#f2c94c",
  "#eb5757",
  "#9b51e0",
  "#00a6a6",
  "#f2994a",
  "#56ccf2",
  "#6fcf97",
  "#bb6bd9",
  "#2d9cdb",
  "#e8590c",
];

const unassignedColor = "#8f9aa7";

export function getGraphGroupColor(groupKey: string | null): string {
  if (!groupKey) return unassignedColor;

  let hash = 0;
  for (let index = 0; index < groupKey.length; index++) {
    hash = (hash * 31 + groupKey.charCodeAt(index)) >>> 0;
  }

  return organizationPalette[hash % organizationPalette.length];
}
