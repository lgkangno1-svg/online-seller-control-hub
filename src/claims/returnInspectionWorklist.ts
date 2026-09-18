export type ReturnInspectionInput = {
  claimId: string;
  market: string;
  receivedAt?: string;
  expectedAt?: string;
  reason?: string;
  refundAmount: number;
  highValueThreshold?: number;
};

export type ReturnInspectionItem = ReturnInspectionInput & {
  priority: number;
  requiresApproval: boolean;
  action: "WAIT_RECEIPT" | "INSPECT" | "ESCALATE";
};

export function buildReturnInspectionWorklist(
  rows: ReturnInspectionInput[],
  now = new Date(),
): ReturnInspectionItem[] {
  return rows
    .map((row) => {
      const threshold = row.highValueThreshold ?? 100_000;
      const received = row.receivedAt ? new Date(row.receivedAt) : undefined;
      const expected = row.expectedAt ? new Date(row.expectedAt) : undefined;
      const ageHours = received ? Math.max(0, (now.getTime() - received.getTime()) / 3_600_000) : 0;
      const overdue = !received && expected ? expected.getTime() < now.getTime() : false;
      const requiresApproval = row.refundAmount >= threshold;
      const priority = Math.round(ageHours) + (overdue ? 72 : 0) + (requiresApproval ? 24 : 0);
      return {
        ...row,
        priority,
        requiresApproval,
        action: overdue ? "ESCALATE" as const : received ? "INSPECT" as const : "WAIT_RECEIPT" as const,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.claimId.localeCompare(b.claimId));
}
