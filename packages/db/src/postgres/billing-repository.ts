import type {
  BillingEventInsertResult,
  BillingRepository,
  CreditSummary,
  ExistingCheckoutSessionIdempotency,
} from "@vi/application";
import type { BillingEventState } from "@vi/domain";
import type { QueryResultRow } from "pg";
import { PostgresClient, type SqlExecutor } from "./client";

interface BillingCustomerRow extends QueryResultRow {
  id: string;
  user_id: string;
  stripe_customer_id: string;
}

interface BillingEventRow extends QueryResultRow {
  id: string;
  billing_customer_id: string | null;
  user_id: string | null;
  stripe_event_id: string;
  event_type: string;
  event_state: BillingEventState;
  payload_redacted: Record<string, unknown>;
}

interface CreditAccountRow extends QueryResultRow {
  id: string;
  balance: number;
  pending_refund: number;
}

function buildCheckoutEventId(userId: string, idempotencyKey: string): string {
  return `checkout_req:${userId}:${idempotencyKey}`;
}

export class PostgresBillingRepository implements BillingRepository {
  public constructor(private readonly client: PostgresClient) {}

  public async getCreditSummary(userId: string): Promise<CreditSummary | null> {
    const result = await this.client.query<CreditAccountRow>(
      `
      select id, balance, pending_refund
      from public.credit_accounts
      where user_id = $1
      limit 1
      `,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      creditAccountId: row.id,
      balance: row.balance,
      pendingRefund: row.pending_refund,
    };
  }

  public async findCheckoutSessionByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckoutSessionIdempotency | null> {
    const checkoutEventId = buildCheckoutEventId(userId, idempotencyKey);
    const result = await this.client.query<BillingEventRow>(
      `
      select *
      from public.billing_events
      where stripe_event_id = $1
        and event_type = 'checkout_session_request'
      limit 1
      `,
      [checkoutEventId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const payload = result.rows[0]!.payload_redacted;
    const packCode =
      typeof payload.pack_code === "string"
        ? payload.pack_code
        : null;
    const successUrl =
      typeof payload.success_url === "string"
        ? payload.success_url
        : null;
    const cancelUrl =
      typeof payload.cancel_url === "string"
        ? payload.cancel_url
        : null;
    const checkoutSessionId =
      typeof payload.checkout_session_id === "string"
        ? payload.checkout_session_id
        : null;
    const checkoutUrl =
      typeof payload.checkout_url === "string"
        ? payload.checkout_url
        : null;

    if (
      packCode === null ||
      successUrl === null ||
      cancelUrl === null ||
      checkoutSessionId === null ||
      checkoutUrl === null
    ) {
      return null;
    }

    return {
      idempotencyKey,
      userId,
      packCode,
      successUrl,
      cancelUrl,
      checkoutSessionId,
      checkoutUrl,
    };
  }

  public async saveCheckoutSessionByIdempotency(input: {
    userId: string;
    idempotencyKey: string;
    packCode: string;
    successUrl: string;
    cancelUrl: string;
    checkoutSessionId: string;
    checkoutUrl: string;
    stripeCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<void> {
    const checkoutEventId = buildCheckoutEventId(input.userId, input.idempotencyKey);
    let billingCustomerId: string | null = null;

    if (input.stripeCustomerId !== null) {
      const customer = await this.findBillingCustomerByStripeCustomerId(input.stripeCustomerId);
      billingCustomerId = customer?.id ?? null;
    }

    await this.client.query(
      `
      insert into public.billing_events (
        billing_customer_id,
        user_id,
        stripe_event_id,
        event_type,
        event_state,
        payload_redacted,
        processed_at
      ) values ($1, $2, $3, 'checkout_session_request', 'completed', $4::jsonb, now())
      on conflict (stripe_event_id) do nothing
      `,
      [
        billingCustomerId,
        input.userId,
        checkoutEventId,
        JSON.stringify({
          pack_code: input.packCode,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          checkout_session_id: input.checkoutSessionId,
          checkout_url: input.checkoutUrl,
          payload: input.payloadRedacted,
        }),
      ],
    );
  }

  public async findBillingCustomerByUserId(userId: string): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  } | null> {
    const result = await this.client.query<BillingCustomerRow>(
      `
      select *
      from public.billing_customers
      where user_id = $1
      limit 1
      `,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      id: row.id,
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
    };
  }

  public async findBillingCustomerByStripeCustomerId(stripeCustomerId: string): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  } | null> {
    const result = await this.client.query<BillingCustomerRow>(
      `
      select *
      from public.billing_customers
      where stripe_customer_id = $1
      limit 1
      `,
      [stripeCustomerId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      id: row.id,
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
    };
  }

  public async upsertBillingCustomer(input: {
    userId: string;
    stripeCustomerId: string;
  }): Promise<{
    id: string;
    userId: string;
    stripeCustomerId: string;
  }> {
    const result = await this.client.query<BillingCustomerRow>(
      `
      insert into public.billing_customers (user_id, stripe_customer_id)
      values ($1, $2)
      on conflict (user_id)
      do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()
      returning *
      `,
      [input.userId, input.stripeCustomerId],
    );

    const row = result.rows[0]!;
    return {
      id: row.id,
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
    };
  }

  public async insertStripeEventIfAbsent(input: {
    stripeEventId: string;
    eventType: string;
    userId: string | null;
    billingCustomerId: string | null;
    payloadRedacted: Record<string, unknown>;
  }): Promise<BillingEventInsertResult> {
    const inserted = await this.client.query<BillingEventRow>(
      `
      insert into public.billing_events (
        billing_customer_id,
        user_id,
        stripe_event_id,
        event_type,
        event_state,
        payload_redacted
      ) values ($1, $2, $3, $4, 'received', $5::jsonb)
      on conflict (stripe_event_id) do nothing
      returning *
      `,
      [
        input.billingCustomerId,
        input.userId,
        input.stripeEventId,
        input.eventType,
        JSON.stringify(input.payloadRedacted),
      ],
    );

    if (inserted.rows.length > 0) {
      return {
        billingEventId: inserted.rows[0]!.id,
        inserted: true,
        eventState: inserted.rows[0]!.event_state,
      };
    }

    const existing = await this.client.query<BillingEventRow>(
      `
      select *
      from public.billing_events
      where stripe_event_id = $1
      limit 1
      `,
      [input.stripeEventId],
    );

    if (existing.rows.length === 0) {
      throw new Error("BILLING_EVENT_CONFLICT_RESOLUTION_FAILED");
    }

    return {
      billingEventId: existing.rows[0]!.id,
      inserted: false,
      eventState: existing.rows[0]!.event_state,
    };
  }

  public async transitionBillingEventState(input: {
    billingEventId: string;
    from: BillingEventState;
    to: BillingEventState;
    failureReason?: string | null;
    processedAt?: Date | null;
  }): Promise<boolean> {
    const values: unknown[] = [input.billingEventId, input.from, input.to];
    const sets: string[] = ["event_state = $3", "updated_at = now()"];

    if (Object.prototype.hasOwnProperty.call(input, "failureReason")) {
      values.push(input.failureReason ?? null);
      sets.push(`failure_reason = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(input, "processedAt")) {
      values.push(input.processedAt ?? null);
      sets.push(`processed_at = $${values.length}`);
    }

    const updated = await this.client.query<{ id: string }>(
      `
      update public.billing_events
      set ${sets.join(", ")}
      where id = $1 and event_state = $2
      returning id
      `,
      values,
    );

    return updated.rows.length > 0;
  }

  public async applyBillingLedgerEntryAndProjection(input: {
    userId: string;
    billingEventId: string;
    entryType: "purchase" | "adjustment";
    reason: "billing_purchase" | "billing_refund";
    amount: number;
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
  }): Promise<{ applied: boolean; balance: number }> {
    return this.client.transaction(async (executor) => {
      const account = await this.loadCreditAccountForUpdate(executor, input.userId);
      if (account === null) {
        throw new Error("CREDIT_ACCOUNT_NOT_FOUND");
      }

      const inserted = await executor.query<{ id: string }>(
        `
        insert into public.credit_ledger_entries (
          credit_account_id,
          user_id,
          entry_type,
          reason,
          amount,
          generation_run_id,
          billing_event_id,
          manual_reference,
          idempotency_key,
          metadata_json
        ) values ($1, $2, $3, $4, $5, null, $6, null, $7, $8::jsonb)
        on conflict (idempotency_key) do nothing
        returning id
        `,
        [
          account.id,
          input.userId,
          input.entryType,
          input.reason,
          input.amount,
          input.billingEventId,
          input.idempotencyKey,
          JSON.stringify(input.metadataJson),
        ],
      );

      if (inserted.rows.length === 0) {
        return {
          applied: false,
          balance: account.balance,
        };
      }

      const nextBalance = account.balance + input.amount;
      if (nextBalance < 0) {
        throw new Error("CREDIT_BALANCE_WOULD_BE_NEGATIVE");
      }

      await executor.query(
        `
        update public.credit_accounts
        set balance = $2, updated_at = now()
        where id = $1
        `,
        [account.id, nextBalance],
      );

      return {
        applied: true,
        balance: nextBalance,
      };
    });
  }

  private async loadCreditAccountForUpdate(
    executor: SqlExecutor,
    userId: string,
  ): Promise<{ id: string; balance: number } | null> {
    const result = await executor.query<{ id: string; balance: number }>(
      `
      select id, balance
      from public.credit_accounts
      where user_id = $1
      for update
      `,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0]!.id,
      balance: result.rows[0]!.balance,
    };
  }
}

export function createPostgresBillingRepository(connectionString: string): PostgresBillingRepository {
  const client = new PostgresClient(connectionString);
  return new PostgresBillingRepository(client);
}
