const PALETTE = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#a78bfa",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForMachine(machineId: string): string {
  return PALETTE[hash(machineId) % PALETTE.length];
}
