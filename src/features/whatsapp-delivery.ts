/**
 * MAMA Disaster Response — WhatsApp Delivery
 *
 * Deliver weather alerts to community leaders via Twilio WhatsApp
 * Business API. Delivery tracking, read receipts, and fallback
 * to SMS for non-WhatsApp numbers.
 *
 * @module whatsapp-delivery
 * @license GPL-3.0
 */

import { z } from "zod";
import type { GeneratedAlert } from "./alert-generation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const CommunityLeader = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  whatsappVerified: z.boolean(),
  region: z.string(),
  country: z.string(),
  language: z.string().default("en"),
  role: z.enum(["chief", "coordinator", "health_worker", "teacher", "religious_leader", "ngo_staff", "other"]),
  communities: z.array(z.string()).describe("Community names this leader serves"),
  totalPopulation: z.number().positive().optional(),
  lastContactedAt: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
});

export type CommunityLeader = z.infer<typeof CommunityLeader>;

export const DeliveryChannel = z.enum(["whatsapp", "sms", "voice"]);

export const DeliveryResult = z.object({
  leaderId: z.string().uuid(),
  leaderName: z.string(),
  channel: DeliveryChannel,
  status: z.enum(["sent", "delivered", "read", "failed", "fallback_sms"]),
  messageId: z.string().optional(),
  sentAt: z.string().datetime(),
  deliveredAt: z.string().datetime().optional(),
  readAt: z.string().datetime().optional(),
  error: z.string().optional(),
});

export type DeliveryResult = z.infer<typeof DeliveryResult>;

export const DeliveryBatchResult = z.object({
  alertId: z.string().uuid(),
  totalRecipients: z.number(),
  sent: z.number(),
  delivered: z.number(),
  read: z.number(),
  failed: z.number(),
  fallbackToSMS: z.number(),
  results: z.array(DeliveryResult),
  coverageEstimate: z.object({
    populationReached: z.number(),
    populationAtRisk: z.number(),
    coveragePercent: z.number(),
  }),
  deliveryStarted: z.string().datetime(),
  deliveryCompleted: z.string().datetime().optional(),
});

export type DeliveryBatchResult = z.infer<typeof DeliveryBatchResult>;

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function formatWhatsAppAlert(alert: GeneratedAlert): string {
  const severityEmoji: Record<string, string> = {
    advisory: "\u2139\uFE0F",
    watch: "\u26A0\uFE0F",
    warning: "\ud83d\udea8",
    emergency: "\ud83c\udd98",
  };

  const emoji = severityEmoji[alert.severity] ?? "\u26A0\uFE0F";

  const lines = [
    `${emoji} *${alert.title}* ${emoji}`,
    "",
    `*Severity:* ${alert.severity.toUpperCase()}`,
    `*Area:* ${alert.affectedArea}`,
    alert.population ? `*Population at risk:* ${alert.population.toLocaleString()}` : "",
    `*Valid:* ${new Date(alert.validFrom).toLocaleDateString()} to ${new Date(alert.validTo).toLocaleDateString()}`,
    "",
    alert.body,
    "",
    "*ACTIONS:*",
    ...alert.actionItems.map((a, i) => `${i + 1}. ${a}`),
    "",
    "_This alert requires your action. Please share with your community._",
    "_Reply CONFIRM when message shared with community._",
    "",
    `\u2014 MAMA Disaster Response | mama.oliwoods.ai`,
  ];

  return lines.filter(Boolean).join("\n");
}

function formatSMSAlert(alert: GeneratedAlert): string {
  // SMS must be concise (160 chars ideal, 320 max)
  const actions = alert.actionItems.slice(0, 2).join(". ");
  return (
    `${alert.severity.toUpperCase()}: ${alert.headline} ` +
    `${actions}. Share with community. Reply CONFIRM. -MAMA`
  ).substring(0, 320);
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Deliver an APPROVED alert to all relevant community leaders.
 *
 * SAFETY: This function REFUSES to send alerts that are not approved.
 * Human-in-the-loop is enforced here as a second check.
 */
export async function deliverAlert(
  alert: GeneratedAlert,
  leaders: CommunityLeader[]
): Promise<DeliveryBatchResult> {
  // CRITICAL SAFETY CHECK: only send approved alerts
  if (alert.approvalStatus !== "approved") {
    throw new Error(
      `BLOCKED: Cannot deliver alert ${alert.id} \u2014 status is "${alert.approvalStatus}". ` +
      `Only approved alerts can be sent. This is a safety requirement.`
    );
  }

  const activeLeaders = leaders.filter((l) => l.isActive);
  const results: DeliveryResult[] = [];

  for (const leader of activeLeaders) {
    const channel: z.infer<typeof DeliveryChannel> = leader.whatsappVerified
      ? "whatsapp"
      : "sms";

    const message = channel === "whatsapp"
      ? formatWhatsAppAlert(alert)
      : formatSMSAlert(alert);

    // In production, this calls Twilio API
    const result: DeliveryResult = {
      leaderId: leader.id,
      leaderName: leader.name,
      channel,
      status: leader.whatsappVerified ? "sent" : "fallback_sms",
      messageId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
    };

    results.push(result);
  }

  const sent = results.filter((r) => r.status !== "failed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const fallback = results.filter((r) => r.status === "fallback_sms").length;

  const totalPopulation = activeLeaders.reduce(
    (sum, l) => sum + (l.totalPopulation ?? 0),
    0
  );

  return {
    alertId: alert.id,
    totalRecipients: activeLeaders.length,
    sent,
    delivered: 0, // Updated async via webhook
    read: 0, // Updated async via webhook
    failed,
    fallbackToSMS: fallback,
    results,
    coverageEstimate: {
      populationReached: totalPopulation,
      populationAtRisk: alert.population ?? 0,
      coveragePercent:
        alert.population && alert.population > 0
          ? Math.min(100, Math.round((totalPopulation / alert.population) * 100))
          : 0,
    },
    deliveryStarted: new Date().toISOString(),
  };
}

/**
 * Handle a community leader's confirmation reply.
 */
export function processConfirmation(
  leaderId: string,
  leaderName: string,
  alertId: string
): {
  confirmed: boolean;
  acknowledgment: string;
  timestamp: string;
} {
  return {
    confirmed: true,
    acknowledgment:
      `Thank you ${leaderName}. Your confirmation has been recorded. ` +
      `Continue to monitor conditions and report any changes to your coordinator.`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get delivery statistics for an alert.
 */
export function getDeliveryStats(batch: DeliveryBatchResult): {
  summary: string;
  confirmationRate: number;
  needsFollowUp: string[];
} {
  const confirmed = batch.results.filter((r) => r.status === "read").length;
  const rate = batch.totalRecipients > 0
    ? Math.round((confirmed / batch.totalRecipients) * 100)
    : 0;

  const needsFollowUp = batch.results
    .filter((r) => r.status === "sent" || r.status === "failed")
    .map((r) => r.leaderName);

  return {
    summary:
      `Alert ${batch.alertId}: ${batch.sent}/${batch.totalRecipients} sent, ` +
      `${confirmed} confirmed, ${batch.failed} failed. ` +
      `Est. ${batch.coverageEstimate.populationReached.toLocaleString()} people reached.`,
    confirmationRate: rate,
    needsFollowUp,
  };
}
