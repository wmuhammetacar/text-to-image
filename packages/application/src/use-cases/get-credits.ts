import type { CreditsResponseDto } from "@vi/contracts";
import type { BillingRepository } from "../ports/billing";
import type { Logger } from "../ports/observability";

export class GetCreditsUseCase {
  public constructor(
    private readonly billingRepository: BillingRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(input: {
    userId: string;
    requestId: string;
  }): Promise<CreditsResponseDto> {
    const summary = await this.billingRepository.getCreditSummary(input.userId);

    const response: CreditsResponseDto = {
      balance: summary?.balance ?? 0,
      pending_refund: summary?.pendingRefund ?? 0,
      request_id: input.requestId,
    };

    this.logger.info("credits_fetched", {
      requestId: input.requestId,
      userId: input.userId,
      balance: response.balance,
      pendingRefund: response.pending_refund,
    });

    return response;
  }
}
