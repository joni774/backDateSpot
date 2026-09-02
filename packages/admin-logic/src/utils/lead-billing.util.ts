import { LeadInvoiceStatus, prisma, type Place, type PlaceLead } from "@datespot/database";
import Stripe from "stripe";

export interface LeadBillingConfig {
  stripeSecretKey?: string;
}

export interface CreatedLeadInvoice {
  id: string;
  placeId: string;
  placeNameHe: string;
  stripeInvoiceId: string | null;
  status: LeadInvoiceStatus;
  totalAgorot: number;
  leadCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  provider: "stripe" | "dev";
}

export type InvoiceSkipReason =
  | "NO_PARTNER_PLACES"
  | "NO_UNBILLED_LEADS"
  | "NO_UNBILLED_LEADS_FOR_PLACE"
  | "MISSING_BILLING_EMAIL"
  | "NO_BILLABLE_FEES"
  | "STRIPE_NOT_CONFIGURED"
  | "INVOICE_FAILED";

export interface SkippedPlaceInvoice {
  placeId: string;
  placeNameHe: string;
  reason: InvoiceSkipReason;
  detail?: string;
}

export interface InvoiceLeadsResult {
  created: CreatedLeadInvoice[];
  skipped: SkippedPlaceInvoice[];
}

type PlaceWithLeads = Place & { leads: PlaceLead[] };

function groupUnbilledByPlace(
  rows: Array<PlaceLead & { place: Place }>
): PlaceWithLeads[] {
  const byPlace = new Map<string, PlaceWithLeads>();
  for (const row of rows) {
    const existing = byPlace.get(row.placeId);
    if (existing) {
      existing.leads.push(row);
      continue;
    }
    byPlace.set(row.placeId, { ...row.place, leads: [row] });
  }
  return [...byPlace.values()];
}

function formatPeriod(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createLeadBillingProcessor(config: LeadBillingConfig) {
  const stripe = config.stripeSecretKey
    ? new Stripe(config.stripeSecretKey, { apiVersion: "2026-08-26.dahlia" })
    : null;

  async function ensureStripeCustomer(place: Place): Promise<string> {
    if (!stripe) {
      throw new Error("STRIPE_NOT_CONFIGURED");
    }
    if (!place.billingEmail?.trim()) {
      throw new Error("MISSING_BILLING_EMAIL");
    }

    if (place.stripeCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(place.stripeCustomerId);
        if (!existing.deleted) {
          return place.stripeCustomerId;
        }
      } catch {
        // Customer missing in Stripe — recreate below.
      }
    }

    const customer = await stripe.customers.create({
      email: place.billingEmail.trim(),
      name: place.nameHe,
      metadata: { datespotPlaceId: place.id },
    });

    await prisma.place.update({
      where: { id: place.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  async function invoicePlace(
    placeWithLeads: PlaceWithLeads,
    sendEmail: boolean
  ): Promise<CreatedLeadInvoice> {
    const leads = placeWithLeads.leads;
    const totalAgorot = leads.reduce((sum, lead) => sum + lead.feeAgorot, 0);
    const periodStart = leads[0]!.createdAt;
    const periodEnd = leads[leads.length - 1]!.createdAt;
    const description = `DateSpot — ${leads.length} leads (${formatPeriod(periodStart)} – ${formatPeriod(periodEnd)})`;

    if (totalAgorot <= 0) {
      throw new Error("NO_BILLABLE_FEES");
    }

    if (!placeWithLeads.billingEmail?.trim()) {
      throw new Error("MISSING_BILLING_EMAIL");
    }

    if (!stripe) {
      const invoice = await prisma.$transaction(async (tx) => {
        const created = await tx.leadInvoice.create({
          data: {
            placeId: placeWithLeads.id,
            status: LeadInvoiceStatus.OPEN,
            totalAgorot,
            leadCount: leads.length,
            periodStart,
            periodEnd,
          },
        });
        await tx.placeLead.updateMany({
          where: { id: { in: leads.map((lead) => lead.id) } },
          data: { leadInvoiceId: created.id },
        });
        return created;
      });

      return {
        id: invoice.id,
        placeId: placeWithLeads.id,
        placeNameHe: placeWithLeads.nameHe,
        stripeInvoiceId: null,
        status: invoice.status,
        totalAgorot: invoice.totalAgorot,
        leadCount: invoice.leadCount,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        createdAt: invoice.createdAt.toISOString(),
        provider: "dev",
      };
    }

    const customerId = await ensureStripeCustomer(placeWithLeads);

    await stripe.invoiceItems.create({
      customer: customerId,
      amount: totalAgorot,
      currency: "ils",
      description,
    });

    const stripeInvoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 14,
      auto_advance: false,
      metadata: {
        datespotPlaceId: placeWithLeads.id,
        datespotLeadCount: String(leads.length),
      },
    });

    const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    if (sendEmail) {
      await stripe.invoices.sendInvoice(finalized.id);
    }

    const status =
      finalized.status === "paid"
        ? LeadInvoiceStatus.PAID
        : finalized.status === "void"
          ? LeadInvoiceStatus.VOID
          : LeadInvoiceStatus.OPEN;

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.leadInvoice.create({
        data: {
          placeId: placeWithLeads.id,
          stripeInvoiceId: finalized.id,
          status,
          totalAgorot,
          leadCount: leads.length,
          periodStart,
          periodEnd,
        },
      });
      await tx.placeLead.updateMany({
        where: { id: { in: leads.map((lead) => lead.id) } },
        data: { leadInvoiceId: created.id },
      });
      return created;
    });

    return {
      id: invoice.id,
      placeId: placeWithLeads.id,
      placeNameHe: placeWithLeads.nameHe,
      stripeInvoiceId: invoice.stripeInvoiceId,
      status: invoice.status,
      totalAgorot: invoice.totalAgorot,
      leadCount: invoice.leadCount,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      provider: "stripe",
    };
  }

  function mapSkipReason(message: string): InvoiceSkipReason {
    const known: InvoiceSkipReason[] = [
      "NO_PARTNER_PLACES",
      "NO_UNBILLED_LEADS",
      "NO_UNBILLED_LEADS_FOR_PLACE",
      "MISSING_BILLING_EMAIL",
      "NO_BILLABLE_FEES",
      "STRIPE_NOT_CONFIGURED",
      "INVOICE_FAILED",
    ];
    if (known.includes(message as InvoiceSkipReason)) {
      return message as InvoiceSkipReason;
    }
    return "INVOICE_FAILED";
  }

  async function invoiceUnbilledLeads(options?: {
    placeId?: string;
    sendEmail?: boolean;
  }): Promise<InvoiceLeadsResult> {
    const sendEmail = options?.sendEmail ?? true;

    const unbilled = await prisma.placeLead.findMany({
      where: {
        leadInvoiceId: null,
        feeAgorot: { gt: 0 },
        ...(options?.placeId
          ? { placeId: options.placeId }
          : { place: { leadBillingEnabled: true, billingEmail: { not: null } } }),
      },
      include: { place: true },
      orderBy: { createdAt: "asc" },
    });

    const grouped = groupUnbilledByPlace(unbilled);
    const created: CreatedLeadInvoice[] = [];
    const skipped: SkippedPlaceInvoice[] = [];

    for (const placeWithLeads of grouped) {
      try {
        created.push(await invoicePlace(placeWithLeads, sendEmail));
      } catch (err) {
        const message = err instanceof Error ? err.message : "INVOICE_FAILED";
        skipped.push({
          placeId: placeWithLeads.id,
          placeNameHe: placeWithLeads.nameHe,
          reason: mapSkipReason(message),
          detail: err instanceof Error && !mapSkipReason(message) ? err.message : undefined,
        });
      }
    }

    if (grouped.length === 0) {
      if (options?.placeId) {
        const place = await prisma.place.findUnique({ where: { id: options.placeId } });
        skipped.push({
          placeId: options.placeId,
          placeNameHe: place?.nameHe ?? options.placeId,
          reason: "NO_UNBILLED_LEADS_FOR_PLACE",
        });
      } else {
        const [partnerPlaces, unbilledAny] = await Promise.all([
          prisma.place.count({
            where: { leadBillingEnabled: true, billingEmail: { not: null } },
          }),
          prisma.placeLead.count({
            where: { leadInvoiceId: null, feeAgorot: { gt: 0 } },
          }),
        ]);

        if (partnerPlaces === 0) {
          skipped.push({
            placeId: "",
            placeNameHe: "",
            reason: "NO_PARTNER_PLACES",
          });
        } else if (unbilledAny === 0) {
          skipped.push({
            placeId: "",
            placeNameHe: "",
            reason: "NO_UNBILLED_LEADS",
          });
        } else {
          skipped.push({
            placeId: "",
            placeNameHe: "",
            reason: "NO_UNBILLED_LEADS",
            detail: "Leads exist but no place has billing email + auto-billing enabled",
          });
        }
      }
    }

    return { created, skipped };
  }

  return {
    invoiceUnbilledLeads,
    isStripeConfigured: Boolean(stripe),
  };
}
