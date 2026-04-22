/**
 * MAMA Disaster Response — Supply Tracker
 *
 * Pre-position emergency supplies based on predicted impact zones.
 * Track inventory across warehouses and distribution points.
 *
 * @module supply-tracker
 * @license GPL-3.0
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SupplyCategory = z.enum([
  "water",
  "food",
  "shelter",
  "medical",
  "hygiene",
  "tools",
  "communication",
  "fuel",
  "clothing",
]);

export const SupplyItem = z.object({
  id: z.string(),
  name: z.string(),
  category: SupplyCategory,
  unit: z.string(),
  quantity: z.number().nonnegative(),
  minimumStock: z.number().nonnegative(),
  expirationDate: z.string().optional(),
  location: z.string(),
  warehouseId: z.string(),
  lastUpdated: z.string().datetime(),
});

export type SupplyItem = z.infer<typeof SupplyItem>;

export const Warehouse = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  capacity: z.number().positive(),
  currentUtilization: z.number().min(0).max(100),
  contactPerson: z.string(),
  contactPhone: z.string(),
  isOperational: z.boolean(),
});

export type Warehouse = z.infer<typeof Warehouse>;

export const SupplyRequest = z.object({
  id: z.string().uuid(),
  requestedBy: z.string(),
  alertId: z.string().optional(),
  region: z.string(),
  items: z.array(
    z.object({
      category: SupplyCategory,
      quantityNeeded: z.number().positive(),
      unit: z.string(),
      priority: z.enum(["critical", "high", "medium", "low"]),
    })
  ),
  populationServing: z.number().positive(),
  status: z.enum(["pending", "approved", "dispatched", "delivered", "partial"]),
  createdAt: z.string().datetime(),
});

export type SupplyRequest = z.infer<typeof SupplyRequest>;

export const SupplyAssessment = z.object({
  region: z.string(),
  populationAtRisk: z.number(),
  daysOfSupply: z.record(z.number()),
  shortages: z.array(
    z.object({
      category: SupplyCategory,
      currentStock: z.number(),
      neededStock: z.number(),
      deficit: z.number(),
      urgency: z.enum(["critical", "urgent", "plan"]),
    })
  ),
  nearestWarehouses: z.array(
    z.object({
      warehouse: Warehouse,
      distanceKm: z.number(),
      hasRequiredSupplies: z.boolean(),
    })
  ),
  recommendations: z.array(z.string()),
});

export type SupplyAssessment = z.infer<typeof SupplyAssessment>;

// ---------------------------------------------------------------------------
// Supply planning constants
// ---------------------------------------------------------------------------

// Per-person daily requirements (Sphere Standards)
const DAILY_REQUIREMENTS: Record<string, { quantity: number; unit: string; category: z.infer<typeof SupplyCategory> }> = {
  water: { quantity: 15, unit: "liters", category: "water" },          // 15L/person/day (drinking + hygiene)
  food_kcal: { quantity: 2100, unit: "kcal", category: "food" },       // 2,100 kcal/person/day
  shelter_sqm: { quantity: 3.5, unit: "sqm", category: "shelter" },    // 3.5 sqm/person
  hygiene_kit: { quantity: 0.033, unit: "kits", category: "hygiene" }, // 1 kit per person per month
  blanket: { quantity: 0.5, unit: "blankets", category: "clothing" },  // 1 per 2 people
};

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Assess supply needs for a region based on population and duration.
 */
export function assessSupplyNeeds(
  region: string,
  population: number,
  durationDays: number,
  currentInventory: SupplyItem[],
  warehouses: Warehouse[]
): SupplyAssessment {
  const shortages: SupplyAssessment["shortages"] = [];
  const daysOfSupply: Record<string, number> = {};

  for (const [key, req] of Object.entries(DAILY_REQUIREMENTS)) {
    const totalNeeded = req.quantity * population * durationDays;
    const currentStock = currentInventory
      .filter((item) => item.category === req.category)
      .reduce((sum, item) => sum + item.quantity, 0);

    const days = currentStock / (req.quantity * population) || 0;
    daysOfSupply[key] = Math.round(days * 10) / 10;

    if (currentStock < totalNeeded) {
      const deficit = totalNeeded - currentStock;
      shortages.push({
        category: req.category,
        currentStock,
        neededStock: totalNeeded,
        deficit,
        urgency: days < 1 ? "critical" : days < 3 ? "urgent" : "plan",
      });
    }
  }

  // Sort warehouses by distance (simplified)
  const nearestWarehouses = warehouses
    .filter((w) => w.isOperational)
    .map((w) => ({
      warehouse: w,
      distanceKm: 0, // In production, calculate from coordinates
      hasRequiredSupplies: w.currentUtilization > 20,
    }))
    .slice(0, 5);

  const recommendations = buildRecommendations(shortages, population, durationDays);

  return {
    region,
    populationAtRisk: population,
    daysOfSupply,
    shortages,
    nearestWarehouses,
    recommendations,
  };
}

function buildRecommendations(
  shortages: SupplyAssessment["shortages"],
  population: number,
  days: number
): string[] {
  const recs: string[] = [];

  const critical = shortages.filter((s) => s.urgency === "critical");
  if (critical.length > 0) {
    recs.push(
      `CRITICAL: ${critical.map((s) => s.category).join(", ")} supplies are critically low. ` +
      `Dispatch from nearest warehouse immediately.`
    );
  }

  const waterShortage = shortages.find((s) => s.category === "water");
  if (waterShortage) {
    recs.push(
      `Water: Need ${(waterShortage.deficit / 1000).toFixed(0)}m\u00B3 ` +
      `(${waterShortage.deficit.toLocaleString()} liters) for ${population.toLocaleString()} people over ${days} days.`
    );
  }

  recs.push(
    `Sphere Standards: Plan for ${(15 * population * days).toLocaleString()}L water, ` +
    `${(2100 * population * days).toLocaleString()} kcal food for full coverage.`
  );

  if (population > 10000) {
    recs.push("Large-scale response: coordinate with UNHCR, WFP, and national disaster management agency.");
  }

  return recs;
}

/**
 * Create a supply request from an alert.
 */
export function createSupplyRequest(
  requestedBy: string,
  alertId: string,
  region: string,
  population: number,
  durationDays: number = 7
): SupplyRequest {
  const items = Object.entries(DAILY_REQUIREMENTS).map(([_, req]) => ({
    category: req.category,
    quantityNeeded: Math.ceil(req.quantity * population * durationDays),
    unit: req.unit,
    priority: req.category === "water" || req.category === "food" ? "critical" as const : "high" as const,
  }));

  return {
    id: crypto.randomUUID(),
    requestedBy,
    alertId,
    region,
    items,
    populationServing: population,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Check for items nearing expiration.
 */
export function checkExpiringItems(
  inventory: SupplyItem[],
  daysThreshold: number = 90
): SupplyItem[] {
  const now = new Date();
  const threshold = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);

  return inventory.filter((item) => {
    if (!item.expirationDate) return false;
    return new Date(item.expirationDate) <= threshold;
  });
}
