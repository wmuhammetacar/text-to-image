import type {
  SubmitUpscaleResponseDto,
  UpscaleRequestDto,
} from "@vi/contracts";
import type { SubmitVariationUseCase } from "./submit-variation";

export interface SubmitUpscaleInput {
  userId: string;
  idempotencyKey: string;
  payload: UpscaleRequestDto;
  requestId: string;
  creditCostPerImage: number;
}

export class SubmitUpscaleUseCase {
  public constructor(
    private readonly submitVariationUseCase: SubmitVariationUseCase,
  ) {}

  public async execute(input: SubmitUpscaleInput): Promise<SubmitUpscaleResponseDto> {
    const result = await this.submitVariationUseCase.execute({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        base_variant_id: input.payload.variant_id,
        variation_type: "upscale",
        variation_parameters: {
          upscale_factor: 2,
          preserve_subject: true,
        },
        requested_image_count: 1,
      },
      requestId: input.requestId,
      creditCostPerImage: input.creditCostPerImage,
    });

    return {
      generation_id: result.generation_id,
      variation_request_id: result.variation_request_id,
      new_run_id: result.new_run_id,
      base_variant_id: input.payload.variant_id,
      active_run_state: result.active_run_state,
      variation_type: "upscale",
      poll_path: result.poll_path,
      request_id: result.request_id,
      correlation_id: result.correlation_id,
    };
  }
}
