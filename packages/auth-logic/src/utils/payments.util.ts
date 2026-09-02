import Stripe from "stripe";

export interface PaymentConfig {
  stripeSecretKey?: string;
}

export interface ChargeResult {
  status: "succeeded" | "requires_action" | "failed";
  provider: "stripe" | "dev-receipt";
  providerRef?: string;
  last4?: string;
}

export interface ChargeInput {
  amountAgorot: number;
  currency: string;
  /** Stripe PaymentMethod id created client-side via @stripe/stripe-react-native (tok_/pm_...). */
  paymentMethodId?: string;
  customerEmail: string;
}

export function createPaymentProcessor(config: PaymentConfig) {
  const stripe = config.stripeSecretKey
    ? new Stripe(config.stripeSecretKey, { apiVersion: "2026-07-29.dahlia" })
    : null;

  async function chargeCard(input: ChargeInput): Promise<ChargeResult> {
    if (!stripe || !input.paymentMethodId) {
      return { status: "succeeded", provider: "dev-receipt" };
    }

    const intent = await stripe.paymentIntents.create({
      amount: input.amountAgorot,
      currency: input.currency.toLowerCase(),
      payment_method: input.paymentMethodId,
      confirm: true,
      receipt_email: input.customerEmail,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      expand: ["latest_charge"],
    });

    const charge = intent.latest_charge;
    const last4 =
      typeof charge === "object" && charge?.payment_method_details?.card?.last4
        ? charge.payment_method_details.card.last4
        : undefined;

    if (intent.status === "succeeded") {
      return { status: "succeeded", provider: "stripe", providerRef: intent.id, last4 };
    }
    if (intent.status === "requires_action") {
      return { status: "requires_action", provider: "stripe", providerRef: intent.id };
    }
    return { status: "failed", provider: "stripe", providerRef: intent.id };
  }

  return { chargeCard, isStripeConfigured: Boolean(stripe) };
}
