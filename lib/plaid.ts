import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

export const plaidEnv = process.env.PLAID_ENV === "production" ? "production" : "sandbox";

export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": plaidEnv === "production" ? process.env.PLAID_SECRET_PRODUCTION! : process.env.PLAID_SECRET_SANDBOX!,
      },
    },
  }),
);

/** Plaid errors arrive as axios errors with the useful part under response.data. */
export function plaidError(e: unknown): { code: string; message: string } {
  const data = (e as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data;
  if (data?.error_code) return { code: data.error_code, message: data.error_message ?? data.error_code };
  return { code: "UNKNOWN", message: e instanceof Error ? e.message : String(e) };
}
