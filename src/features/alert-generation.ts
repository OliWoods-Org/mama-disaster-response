/**
 * MAMA Disaster Response — Alert Generation
 *
 * Context-aware alert creation with severity classification,
 * action items, and multi-language support. Human-in-the-loop
 * approval required before any alert is sent.
 *
 * @module alert-generation
 * @license GPL-3.0
 */

import { z } from "zod";
import type { NormalizedWeatherEvent } from "./weather-ingestion";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AlertLanguage = z.enum([
  "en", "fr", "sw", "ha", "am", "pt", "ar", "yo", "ig", "zu",
]);

export const AlertUrgency = z.enum([
  "immediate",
  "expected",
  "future",
  "past",
]);

export const GeneratedAlert = z.object({
  id: z.string().uuid(),
  weatherEventId: z.string().uuid(),
  language: AlertLanguage,
  title: z.string(),
  severity: z.enum(["advisory", "watch", "warning", "emergency"]),
  urgency: AlertUrgency,
  headline: z.string().max(160).describe("SMS-length headline"),
  body: z.string(),
  actionItems: z.array(z.string()),
  affectedArea: z.string(),
  population: z.number().optional(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  approvalStatus: z.enum(["pending", "approved", "rejected", "expired"]),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type GeneratedAlert = z.infer<typeof GeneratedAlert>;

export const ApprovalDecision = z.object({
  alertId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "modify"]),
  coordinatorId: z.string(),
  coordinatorName: z.string(),
  reason: z.string().optional(),
  modifications: z.string().optional(),
});

export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

// ---------------------------------------------------------------------------
// Alert templates (multi-language)
// ---------------------------------------------------------------------------

interface AlertTemplate {
  title: (hazard: string, region: string) => string;
  body: (hazard: string, region: string, details: string) => string;
  actionPrefix: string;
}

const TEMPLATES: Record<string, AlertTemplate> = {
  en: {
    title: (h, r) => `${h.toUpperCase()} ALERT: ${r}`,
    body: (h, r, d) =>
      `A ${h} event has been detected in ${r}. ${d} ` +
      `Take immediate precautions. Follow instructions from local authorities.`,
    actionPrefix: "ACTIONS:",
  },
  fr: {
    title: (h, r) => `ALERTE ${h.toUpperCase()}: ${r}`,
    body: (h, r, d) =>
      `Un \u00E9v\u00E9nement de ${h} a \u00E9t\u00E9 d\u00E9tect\u00E9 dans la r\u00E9gion de ${r}. ${d} ` +
      `Prenez des pr\u00E9cautions imm\u00E9diates. Suivez les instructions des autorit\u00E9s locales.`,
    actionPrefix: "ACTIONS:",
  },
  sw: {
    title: (h, r) => `TAHADHARI YA ${h.toUpperCase()}: ${r}`,
    body: (h, r, d) =>
      `Tukio la ${h} limegunduliwa katika ${r}. ${d} ` +
      `Chukua tahadhari mara moja. Fuata maelekezo kutoka mamlaka za eneo.`,
    actionPrefix: "HATUA:",
  },
  ha: {
    title: (h, r) => `GARGADI NA ${h.toUpperCase()}: ${r}`,
    body: (h, r, d) =>
      `An gano lamarin ${h} a yankin ${r}. ${d} ` +
      `Ku dauki matakan kariya nan take. Ku bi umarnin hukumomin yankin.`,
    actionPrefix: "AYYUKA:",
  },
  pt: {
    title: (h, r) => `ALERTA DE ${h.toUpperCase()}: ${r}`,
    body: (h, r, d) =>
      `Um evento de ${h} foi detectado na regi\u00E3o de ${r}. ${d} ` +
      `Tome precau\u00E7\u00F5es imediatas. Siga as instru\u00E7\u00F5es das autoridades locais.`,
    actionPrefix: "A\u00C7\u00D5ES:",
  },
  ar: {
    title: (h, r) => `\u062A\u0646\u0628\u064A\u0647 ${h}: ${r}`,
    body: (h, r, d) =>
      `\u062A\u0645 \u0631\u0635\u062F \u062D\u062F\u062B ${h} \u0641\u064A \u0645\u0646\u0637\u0642\u0629 ${r}. ${d} ` +
      `\u0627\u062A\u062E\u0630 \u0627\u062D\u062A\u064A\u0627\u0637\u0627\u062A \u0641\u0648\u0631\u064A\u0629.`,
    actionPrefix: "\u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A:",
  },
};

// ---------------------------------------------------------------------------
// Action items by hazard type
// ---------------------------------------------------------------------------

const HAZARD_ACTIONS: Record<string, string[]> = {
  flood: [
    "Move to higher ground immediately.",
    "Do not walk or drive through floodwater.",
    "Secure important documents in waterproof bags.",
    "Store clean drinking water.",
    "Move livestock to safe ground.",
    "Stay away from rivers and streams.",
  ],
  drought: [
    "Conserve water immediately.",
    "Protect remaining crops with mulching.",
    "Contact agricultural extension services.",
    "Check on elderly and vulnerable neighbors.",
    "Report water source status to local authorities.",
  ],
  cyclone: [
    "Seek sturdy shelter immediately.",
    "Stay away from windows and doors.",
    "Secure loose objects outdoors.",
    "Store 3 days of water and food.",
    "Charge phones and radios.",
    "If near coast, move inland and to higher ground.",
  ],
  extreme_heat: [
    "Stay indoors during peak heat (10am-4pm).",
    "Drink water frequently. Do not wait until thirsty.",
    "Check on elderly, children, and ill neighbors.",
    "Never leave children or animals in vehicles.",
    "Seek shade if working outdoors. Take frequent breaks.",
  ],
  dust_storm: [
    "Stay indoors and close windows.",
    "Cover nose and mouth with damp cloth.",
    "If driving, pull over and turn off engine.",
    "Protect eyes with goggles or glasses.",
    "Check on people with respiratory conditions.",
  ],
  landslide: [
    "Evacuate hillside areas immediately.",
    "Do not return until authorities declare safe.",
    "Listen for unusual sounds (rumbling, cracking trees).",
    "Watch for changes in water flow patterns.",
    "Move away from the path of a landslide, not down.",
  ],
};

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Generate an alert from a normalized weather event.
 *
 * IMPORTANT: All generated alerts have approvalStatus "pending".
 * NO alert is sent without human approval. This is not configurable.
 */
export async function generateAlert(
  event: NormalizedWeatherEvent,
  language: z.infer<typeof AlertLanguage> = "en"
): Promise<GeneratedAlert> {
  const template = TEMPLATES[language] ?? TEMPLATES.en;
  const hazardName = event.hazardType.replace(/_/g, " ");
  const regionName = event.region.name;

  const details = buildDetails(event);
  const actions = HAZARD_ACTIONS[event.hazardType] ?? [
    "Follow instructions from local authorities.",
    "Stay informed via local radio.",
    "Check on vulnerable neighbors.",
  ];

  const headline = `${hazardName.toUpperCase()}: ${regionName} - ${event.severity.toUpperCase()}. Take action now.`;

  return {
    id: crypto.randomUUID(),
    weatherEventId: event.id,
    language,
    title: template.title(hazardName, regionName),
    severity: event.severity,
    urgency: mapSeverityToUrgency(event.severity),
    headline: headline.substring(0, 160),
    body: template.body(hazardName, regionName, details),
    actionItems: actions,
    affectedArea: `${regionName}, ${event.region.country}`,
    population: event.impactEstimate.populationAtRisk,
    validFrom: event.forecastWindow.start,
    validTo: event.forecastWindow.end,
    approvalStatus: "pending", // ALWAYS pending until human approves
    createdAt: new Date().toISOString(),
  };
}

/**
 * Process a coordinator's approval/rejection decision.
 *
 * HUMAN-IN-THE-LOOP: This is the critical gate. No alert goes out without
 * explicit approval from a verified coordinator.
 */
export function processApproval(
  alert: GeneratedAlert,
  decision: ApprovalDecision
): GeneratedAlert {
  const parsed = ApprovalDecision.parse(decision);

  if (parsed.decision === "approve") {
    return {
      ...alert,
      approvalStatus: "approved",
      approvedBy: parsed.coordinatorName,
      approvedAt: new Date().toISOString(),
    };
  }

  if (parsed.decision === "reject") {
    return {
      ...alert,
      approvalStatus: "rejected",
    };
  }

  // Modify: apply changes and keep pending for re-review
  return {
    ...alert,
    body: parsed.modifications ?? alert.body,
    approvalStatus: "pending",
  };
}

function buildDetails(event: NormalizedWeatherEvent): string {
  const parts: string[] = [];

  if (event.parameters.rainfall_mm) {
    parts.push(`Expected rainfall: ${event.parameters.rainfall_mm}mm.`);
  }
  if (event.parameters.wind_kph) {
    parts.push(`Wind speeds: ${event.parameters.wind_kph} km/h.`);
  }
  if (event.parameters.temperature_c) {
    parts.push(`Temperature: ${event.parameters.temperature_c}\u00B0C.`);
  }
  if (event.parameters.river_level_m) {
    parts.push(`River level: ${event.parameters.river_level_m}m.`);
  }
  if (event.impactEstimate.populationAtRisk > 0) {
    parts.push(`Estimated ${event.impactEstimate.populationAtRisk.toLocaleString()} people at risk.`);
  }

  parts.push(`Confidence: ${event.confidence}%. Sources: ${event.sources.join(", ")}.`);

  return parts.join(" ");
}

function mapSeverityToUrgency(severity: string): z.infer<typeof AlertUrgency> {
  switch (severity) {
    case "emergency": return "immediate";
    case "warning": return "expected";
    case "watch": return "future";
    default: return "future";
  }
}

/**
 * Generate alerts in multiple languages for the same event.
 */
export async function generateMultiLanguageAlerts(
  event: NormalizedWeatherEvent,
  languages: z.infer<typeof AlertLanguage>[]
): Promise<GeneratedAlert[]> {
  return Promise.all(languages.map((lang) => generateAlert(event, lang)));
}
