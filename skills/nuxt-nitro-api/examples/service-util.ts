// server/utils/stripe.ts
// Server-side service integration pattern using Stripe

import Stripe from "stripe";

// Initialize at module level with runtime config
const config = useRuntimeConfig();
const stripe = new Stripe(config.stripe.secretKey);

// Define typed methods
interface CreatePaymentIntentOptions {
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}

async function createPaymentIntent(options: CreatePaymentIntentOptions) {
  try {
    return await stripe.paymentIntents.create({
      amount: options.amount,
      currency: options.currency,
      metadata: options.metadata,
    });
  } catch (error: any) {
    // Transform SDK errors to HTTP errors
    throw createError({
      statusCode: error.statusCode || 500,
      message: `Stripe error: ${error.message}`,
    });
  }
}

async function getCustomer(customerId: string) {
  try {
    return await stripe.customers.retrieve(customerId);
  } catch (error: any) {
    if (error.code === "resource_missing") {
      return null;
    }
    throw createError({
      statusCode: error.statusCode || 500,
      message: `Stripe error: ${error.message}`,
    });
  }
}

async function createCustomer(email: string, name: string) {
  return await stripe.customers.create({ email, name });
}

// Export as use*() function
export function useStripe() {
  return {
    createPaymentIntent,
    getCustomer,
    createCustomer,
    client: stripe, // Expose for advanced usage
  };
}

// Usage in API handler:
// const { createPaymentIntent } = useStripe();
// const intent = await createPaymentIntent({ amount: 1000, currency: "usd" });
