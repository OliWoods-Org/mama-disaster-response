/**
 * MAMA Disaster Response — Weather Ingestion
 *
 * Pull weather data from multiple sources (NOAA, local met services,
 * satellite imagery) and normalize into a unified alert format for
 * the Africa Early Warning System.
 *
 * @module weather-ingestion
 * @license GPL-3.0
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const WeatherSource = z.enum([
  "noaa",
  "ecmwf",
  "acmad",
  "local_met_service",
  "satellite",
  "ground_station",
  "community_report",
]);

export const HazardType = z.enum([
  "flood",
  "drought",
  "cyclone",
  "extreme_heat",
  "extreme_cold",
  "wildfire",
  "locust_swarm",
  "landslide",
  "storm_surge",
  "thunderstorm",
  "dust_storm",
]);

export const SeverityLevel = z.enum([
  "advisory",
  "watch",
  "warning",
  "emergency",
]);

export const GeoPoint = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const GeoRegion = z.object({
  name: z.string(),
  country: z.string(),
  county: z.string().optional(),
  coordinates: z.array(GeoPoint).min(1),
  population: z.number().positive().optional(),
});

export const RawWeatherData = z.object({
  source: WeatherSource,
  timestamp: z.string().datetime(),
  region: GeoRegion,
  temperature: z.number().optional(),
  rainfall_mm: z.number().optional(),
  windSpeed_kph: z.number().optional(),
  humidity_percent: z.number().min(0).max(100).optional(),
  pressure_hpa: z.number().optional(),
  riverLevel_m: z.number().optional(),
  soilMoisture_percent: z.number().min(0).max(100).optional(),
  satelliteImageUrl: z.string().url().optional(),
  raw: z.record(z.unknown()).optional(),
});

export type RawWeatherData = z.infer<typeof RawWeatherData>;

export const NormalizedWeatherEvent = z.object({
  id: z.string().uuid(),
  hazardType: HazardType,
  severity: SeverityLevel,
  confidence: z.number().min(0).max(100),
  region: GeoRegion,
  sources: z.array(WeatherSource),
  parameters: z.record(z.number()),
  forecastWindow: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  impactEstimate: z.object({
    populationAtRisk: z.number(),
    agriculturalAreaKm2: z.number().optional(),
    infrastructureRisk: z.enum(["low", "moderate", "high", "critical"]),
  }),
  ingestedAt: z.string().datetime(),
});

export type NormalizedWeatherEvent = z.infer<typeof NormalizedWeatherEvent>;

// ---------------------------------------------------------------------------
// Hazard detection thresholds (Africa-specific)
// ---------------------------------------------------------------------------

interface HazardThreshold {
  hazardType: z.infer<typeof HazardType>;
  condition: (data: RawWeatherData) => boolean;
  severity: (data: RawWeatherData) => z.infer<typeof SeverityLevel>;
}

const HAZARD_THRESHOLDS: HazardThreshold[] = [
  {
    hazardType: "flood",
    condition: (d) => (d.rainfall_mm ?? 0) > 50 || (d.riverLevel_m ?? 0) > 5,
    severity: (d) => {
      const rain = d.rainfall_mm ?? 0;
      if (rain > 200) return "emergency";
      if (rain > 100) return "warning";
      if (rain > 75) return "watch";
      return "advisory";
    },
  },
  {
    hazardType: "drought",
    condition: (d) => (d.soilMoisture_percent ?? 100) < 20 && (d.rainfall_mm ?? 100) < 5,
    severity: (d) => {
      const moisture = d.soilMoisture_percent ?? 100;
      if (moisture < 5) return "emergency";
      if (moisture < 10) return "warning";
      return "watch";
    },
  },
  {
    hazardType: "cyclone",
    condition: (d) => (d.windSpeed_kph ?? 0) > 90 && (d.pressure_hpa ?? 1013) < 990,
    severity: (d) => {
      const wind = d.windSpeed_kph ?? 0;
      if (wind > 200) return "emergency";
      if (wind > 150) return "warning";
      if (wind > 120) return "watch";
      return "advisory";
    },
  },
  {
    hazardType: "extreme_heat",
    condition: (d) => (d.temperature ?? 0) > 42,
    severity: (d) => {
      const temp = d.temperature ?? 0;
      if (temp > 50) return "emergency";
      if (temp > 47) return "warning";
      if (temp > 44) return "watch";
      return "advisory";
    },
  },
  {
    hazardType: "dust_storm",
    condition: (d) => (d.windSpeed_kph ?? 0) > 60 && (d.humidity_percent ?? 100) < 15,
    severity: (d) => {
      const wind = d.windSpeed_kph ?? 0;
      if (wind > 100) return "warning";
      return "watch";
    },
  },
];

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Ingest raw weather data and detect potential hazards.
 */
export async function ingestWeatherData(
  dataPoints: RawWeatherData[]
): Promise<NormalizedWeatherEvent[]> {
  const events: NormalizedWeatherEvent[] = [];

  for (const data of dataPoints) {
    const parsed = RawWeatherData.parse(data);

    for (const threshold of HAZARD_THRESHOLDS) {
      if (threshold.condition(parsed)) {
        const severity = threshold.severity(parsed);

        events.push({
          id: crypto.randomUUID(),
          hazardType: threshold.hazardType,
          severity,
          confidence: calculateConfidence(parsed),
          region: parsed.region,
          sources: [parsed.source],
          parameters: extractParameters(parsed),
          forecastWindow: {
            start: parsed.timestamp,
            end: new Date(
              new Date(parsed.timestamp).getTime() + 48 * 60 * 60 * 1000
            ).toISOString(),
          },
          impactEstimate: {
            populationAtRisk: parsed.region.population ?? 0,
            infrastructureRisk: severity === "emergency" ? "critical" : severity === "warning" ? "high" : "moderate",
          },
          ingestedAt: new Date().toISOString(),
        });
      }
    }
  }

  // Deduplicate events for same region + hazard type
  return deduplicateEvents(events);
}

function calculateConfidence(data: RawWeatherData): number {
  let confidence = 50; // base

  // Multiple source types increase confidence
  if (data.source === "noaa" || data.source === "ecmwf") confidence += 25;
  if (data.source === "acmad") confidence += 20;
  if (data.source === "satellite") confidence += 15;
  if (data.source === "ground_station") confidence += 20;

  // More data points = higher confidence
  const dataPoints = [
    data.temperature,
    data.rainfall_mm,
    data.windSpeed_kph,
    data.humidity_percent,
    data.riverLevel_m,
    data.soilMoisture_percent,
  ].filter((v) => v !== undefined).length;

  confidence += dataPoints * 3;

  return Math.min(100, confidence);
}

function extractParameters(data: RawWeatherData): Record<string, number> {
  const params: Record<string, number> = {};
  if (data.temperature !== undefined) params.temperature_c = data.temperature;
  if (data.rainfall_mm !== undefined) params.rainfall_mm = data.rainfall_mm;
  if (data.windSpeed_kph !== undefined) params.wind_kph = data.windSpeed_kph;
  if (data.humidity_percent !== undefined) params.humidity_pct = data.humidity_percent;
  if (data.riverLevel_m !== undefined) params.river_level_m = data.riverLevel_m;
  if (data.soilMoisture_percent !== undefined) params.soil_moisture_pct = data.soilMoisture_percent;
  return params;
}

function deduplicateEvents(events: NormalizedWeatherEvent[]): NormalizedWeatherEvent[] {
  const seen = new Map<string, NormalizedWeatherEvent>();

  for (const event of events) {
    const key = `${event.region.name}-${event.hazardType}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, event);
    } else {
      // Keep the higher severity event
      const severityOrder = ["advisory", "watch", "warning", "emergency"];
      if (severityOrder.indexOf(event.severity) > severityOrder.indexOf(existing.severity)) {
        seen.set(key, {
          ...event,
          sources: [...new Set([...existing.sources, ...event.sources])],
          confidence: Math.max(existing.confidence, event.confidence),
        });
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Get list of supported weather data sources for a country.
 */
export function getSupportedSources(country: string): {
  source: z.infer<typeof WeatherSource>;
  name: string;
  coverage: string;
}[] {
  const globalSources = [
    { source: "noaa" as const, name: "NOAA Global Forecast System", coverage: "Global" },
    { source: "ecmwf" as const, name: "ECMWF (European Centre)", coverage: "Global" },
    { source: "satellite" as const, name: "EUMETSAT/NOAA Satellite", coverage: "Global" },
  ];

  const africaSources = [
    { source: "acmad" as const, name: "African Centre of Meteorological Applications (ACMAD)", coverage: "Pan-African" },
  ];

  return [...globalSources, ...africaSources];
}
