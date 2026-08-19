import { prisma } from "@datespot/database";

export type SecurityLayer = "PRE_FILTER" | "POST_FILTER";

/** Persist blocked attempts for audit (policy §7.1). */
export async function logSecurityBlock(params: {
  userId?: string | null;
  sessionId?: string | null;
  layer: SecurityLayer;
  reason: string;
  rawMessage?: string | null;
}): Promise<void> {
  const raw =
    params.rawMessage != null
      ? params.rawMessage.slice(0, 500)
      : undefined;
  try {
    await prisma.aiSecurityLog.create({
      data: {
        userId: params.userId ?? undefined,
        sessionId: params.sessionId ?? undefined,
        layer: params.layer,
        reason: params.reason.slice(0, 200),
        rawMessage: raw,
      },
    });
  } catch (err) {
    console.error("[ai-security] failed to write AiSecurityLog:", err);
  }
  console.warn(
    `[ai-security] blocked layer=${params.layer} reason=${params.reason} user=${params.userId ?? "-"}`
  );
}
