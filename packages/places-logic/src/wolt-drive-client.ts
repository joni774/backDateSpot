/**
 * Wolt Drive API client scaffold (feature-flagged).
 *
 * Wolt Drive does not offer self-serve API signup. Credentials (Merchant Key + venue id)
 * are issued by a Wolt account / technical account manager after a business contract.
 *
 * Env:
 * - WOLT_DRIVE_MERCHANT_KEY — Bearer token (Merchant Key) for Drive API
 * - WOLT_DRIVE_VENUE_ID — venue UUID used in venueful endpoints
 * - WOLT_DRIVE_BASE_URL — optional; defaults to production
 * - WOLT_DRIVE_CLIENT_ID / WOLT_DRIVE_CLIENT_SECRET — reserved for marketplace OAuth (not Drive)
 *
 * No routes mount this yet. Wire quote/create after credentials exist.
 *
 * Docs: https://developer.wolt.com/docs/wolt-drive/endpoints
 */

const DEFAULT_BASE_URL = "https://daas-public-api.wolt.com";

export type WoltDriveConfig = {
  merchantKey: string | null;
  venueId: string | null;
  baseUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  /** True when Merchant Key + venue id are present (enough to call Drive venueful APIs). */
  isConfigured: boolean;
};

export type WoltLatLng = {
  lat: number;
  lng: number;
};

export type WoltDeliveryQuoteRequest = {
  dropoff: WoltLatLng;
  /** ISO 8601 scheduled pickup time; omit for ASAP. */
  scheduledDropoffTime?: string;
};

export type WoltDeliveryQuote = {
  id: string;
  price: { amount: number; currency: string };
  etaMinutes?: number;
  raw: unknown;
};

export type WoltCreateDeliveryRequest = {
  /** Shipment promise / quote id from getWoltDeliveryQuote when required by venue config. */
  shipmentPromiseId?: string;
  dropoff: {
    location: WoltLatLng;
    comment?: string;
  };
  recipient: {
    name: string;
    phoneNumber: string;
    email?: string;
  };
  parcels?: Array<{ description?: string; price?: { amount: number; currency: string } }>;
};

export type WoltDelivery = {
  id: string;
  trackingUrl?: string;
  status?: string;
  raw: unknown;
};

export function getWoltDriveConfig(): WoltDriveConfig {
  const merchantKey = process.env.WOLT_DRIVE_MERCHANT_KEY?.trim() || null;
  const venueId = process.env.WOLT_DRIVE_VENUE_ID?.trim() || null;
  const baseUrl =
    process.env.WOLT_DRIVE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const clientId = process.env.WOLT_DRIVE_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.WOLT_DRIVE_CLIENT_SECRET?.trim() || null;

  return {
    merchantKey,
    venueId,
    baseUrl: baseUrl.replace(/\/$/, ""),
    clientId,
    clientSecret,
    isConfigured: Boolean(merchantKey && venueId),
  };
}

/**
 * Returns the Drive Merchant Key for Authorization: Bearer.
 * Throws when Drive is not configured — callers must check isConfigured first.
 */
export async function getWoltAccessToken(): Promise<string> {
  const config = getWoltDriveConfig();
  if (!config.merchantKey) {
    throw new Error(
      "Wolt Drive not configured: set WOLT_DRIVE_MERCHANT_KEY (and WOLT_DRIVE_VENUE_ID)"
    );
  }
  // Drive uses a static Merchant Key issued by Wolt (not OAuth client-credentials).
  // Marketplace Order API uses OAuth; keep CLIENT_ID/SECRET env reserved for that path.
  return config.merchantKey;
}

async function woltFetch(
  path: string,
  init: RequestInit & { token: string }
): Promise<Response> {
  const config = getWoltDriveConfig();
  const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${init.token}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  const { token: _token, ...rest } = init;
  return fetch(url, { ...rest, headers });
}

/**
 * Request a shipment promise / delivery quote for a venue dropoff.
 * Maps to POST /v1/venues/{venue_id}/shipment-promises (venueful).
 */
export async function getWoltDeliveryQuote(
  request: WoltDeliveryQuoteRequest
): Promise<WoltDeliveryQuote> {
  const config = getWoltDriveConfig();
  if (!config.isConfigured || !config.venueId) {
    throw new Error("Wolt Drive not configured");
  }
  const token = await getWoltAccessToken();
  const res = await woltFetch(`/v1/venues/${config.venueId}/shipment-promises`, {
    method: "POST",
    token,
    body: JSON.stringify({
      dropoff: {
        location: { lat: request.dropoff.lat, lon: request.dropoff.lng },
      },
      ...(request.scheduledDropoffTime
        ? { scheduled_dropoff_time: request.scheduledDropoffTime }
        : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Wolt Drive quote failed (${res.status}): ${body}`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const id = String(raw.id ?? raw.shipment_promise_id ?? "");
  const priceObj = (raw.price ?? raw.fee ?? {}) as Record<string, unknown>;
  return {
    id,
    price: {
      amount: Number(priceObj.amount ?? priceObj.value ?? 0),
      currency: String(priceObj.currency ?? "ILS"),
    },
    etaMinutes:
      typeof raw.eta_minutes === "number"
        ? raw.eta_minutes
        : typeof raw.dropoff_eta === "number"
          ? raw.dropoff_eta
          : undefined,
    raw,
  };
}

/**
 * Create a Wolt Drive delivery for the configured venue.
 * Maps to POST /v1/venues/{venue_id}/deliveries.
 */
export async function createWoltDelivery(
  request: WoltCreateDeliveryRequest
): Promise<WoltDelivery> {
  const config = getWoltDriveConfig();
  if (!config.isConfigured || !config.venueId) {
    throw new Error("Wolt Drive not configured");
  }
  const token = await getWoltAccessToken();
  const res = await woltFetch(`/v1/venues/${config.venueId}/deliveries`, {
    method: "POST",
    token,
    body: JSON.stringify({
      ...(request.shipmentPromiseId
        ? { shipment_promise_id: request.shipmentPromiseId }
        : {}),
      dropoff: {
        location: {
          lat: request.dropoff.location.lat,
          lon: request.dropoff.location.lng,
        },
        comment: request.dropoff.comment,
      },
      recipient: {
        name: request.recipient.name,
        phone_number: request.recipient.phoneNumber,
        email: request.recipient.email,
      },
      parcels: request.parcels,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Wolt Drive create delivery failed (${res.status}): ${body}`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return {
    id: String(raw.id ?? raw.wolt_order_reference_id ?? ""),
    trackingUrl:
      typeof raw.tracking_url === "string"
        ? raw.tracking_url
        : typeof raw.trackingUrl === "string"
          ? raw.trackingUrl
          : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    raw,
  };
}
