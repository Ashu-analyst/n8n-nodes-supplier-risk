/**
 * Pure scoring logic, kept separate from the n8n wrapper so it can be unit-tested
 * without n8n and reused anywhere (API, Zoho Deluge port, batch job).
 *
 * Score 0 = lowest risk, 100 = highest risk.
 *   country risk     30%  (0–100 index for the country of production)
 *   category risk    25%  (inherent risk of the purchasing category)
 *   questionnaire    25%  (inverse of the self-assessment score; missing = worst)
 *   adverse media    20%  (verified negative news items in 24 months, capped at 5)
 */

export type RiskBand = 'Low' | 'Medium' | 'High';
export type Route = 'auto-approve' | 'category-manager' | 'compliance-committee';

export interface SupplierInput {
  supplierId: string;
  countryRiskIndex: number; // 0–100, higher = riskier
  category: string;
  saqScore?: number | null; // 0–100, higher = better answers
  adverseMediaCount?: number; // verified items in the last 24 months
  overridePoints?: number; // compliance-officer override, −15..+15
}

export interface RiskResult {
  supplierId: string;
  score: number;
  band: RiskBand;
  route: Route;
  components: { country: number; category: number; questionnaire: number; media: number };
  warnings: string[];
}

export const WEIGHTS = { country: 0.3, category: 0.25, questionnaire: 0.25, media: 0.2 } as const;

export const CATEGORY_RISK: Record<string, number> = {
  'raw materials': 90,
  textiles: 85,
  'electronics assembly': 80,
  chemicals: 75,
  logistics: 50,
  packaging: 45,
  'it hardware': 40,
  'office services': 15,
  software: 10,
};

const DEFAULT_CATEGORY_RISK = 50;
const MAX_MEDIA_ITEMS = 5;
const MAX_OVERRIDE = 15;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function bandFor(score: number): RiskBand {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

export function routeFor(band: RiskBand): Route {
  return band === 'High' ? 'compliance-committee' : band === 'Medium' ? 'category-manager' : 'auto-approve';
}

export function scoreSupplier(input: SupplierInput): RiskResult {
  const warnings: string[] = [];

  if (!input.supplierId) throw new Error('supplierId is required');
  if (Number.isNaN(Number(input.countryRiskIndex))) throw new Error(`countryRiskIndex must be a number (supplier ${input.supplierId})`);

  const country = clamp(Number(input.countryRiskIndex), 0, 100);
  if (country !== Number(input.countryRiskIndex)) warnings.push('countryRiskIndex was outside 0–100 and was clamped');

  const catKey = (input.category ?? '').trim().toLowerCase();
  let category = CATEGORY_RISK[catKey];
  if (category === undefined) {
    category = DEFAULT_CATEGORY_RISK;
    warnings.push(`Unknown category "${input.category}", used default risk ${DEFAULT_CATEGORY_RISK}`);
  }

  let questionnaire: number;
  if (input.saqScore === undefined || input.saqScore === null) {
    questionnaire = 100; // missing answers count as the worst answer
    warnings.push('No questionnaire score, treated as worst case');
  } else {
    questionnaire = 100 - clamp(Number(input.saqScore), 0, 100);
  }

  const mediaItems = clamp(Math.floor(Number(input.adverseMediaCount ?? 0)), 0, MAX_MEDIA_ITEMS);
  const media = (mediaItems / MAX_MEDIA_ITEMS) * 100;

  let score =
    country * WEIGHTS.country +
    category * WEIGHTS.category +
    questionnaire * WEIGHTS.questionnaire +
    media * WEIGHTS.media;

  if (input.overridePoints) {
    const ov = clamp(Number(input.overridePoints), -MAX_OVERRIDE, MAX_OVERRIDE);
    if (ov !== Number(input.overridePoints)) warnings.push(`Override limited to ±${MAX_OVERRIDE} points`);
    score += ov;
  }

  score = Math.round(clamp(score, 0, 100) * 10) / 10;
  const band = bandFor(score);

  return {
    supplierId: input.supplierId,
    score,
    band,
    route: routeFor(band),
    components: { country, category, questionnaire, media },
    warnings,
  };
}
