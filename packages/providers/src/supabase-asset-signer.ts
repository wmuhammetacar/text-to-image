import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetSigner } from "@vi/application/use-cases/get-generation-detail";
import {
  assertSafeBucketName,
  assertSafeStoragePath,
} from "./storage-path";

export class SupabaseAssetSigner implements AssetSigner {
  public constructor(
    private readonly supabase: SupabaseClient,
    private readonly allowedBucket: string,
  ) {
    assertSafeBucketName(allowedBucket);
  }

  public async sign(params: {
    bucket: string;
    path: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    if (params.bucket !== this.allowedBucket) {
      throw new Error("DISALLOWED_STORAGE_BUCKET");
    }

    assertSafeStoragePath(params.path);

    const { data, error } = await this.supabase.storage
      .from(params.bucket)
      .createSignedUrl(params.path, params.expiresInSeconds);

    if (error !== null || data?.signedUrl === undefined) {
      throw new Error("SIGNED_URL_CREATION_FAILED");
    }

    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + params.expiresInSeconds * 1000),
    };
  }
}
