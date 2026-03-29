import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeBucketName, assertSafeStoragePath } from "./storage-path";
import { ProviderRetryableError } from "./errors";

export interface ImageAssetStoreUploadInput {
  bucket: string;
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ImageAssetStore {
  upload(input: ImageAssetStoreUploadInput): Promise<void>;
}

export class SupabaseImageAssetStore implements ImageAssetStore {
  private readonly supabase: SupabaseClient;
  private readonly providerName: string;

  public constructor(supabase: SupabaseClient, providerName = "openai-image-generation") {
    this.supabase = supabase;
    this.providerName = providerName;
  }

  public async upload(input: ImageAssetStoreUploadInput): Promise<void> {
    assertSafeBucketName(input.bucket);
    assertSafeStoragePath(input.path);

    const { error } = await this.supabase.storage.from(input.bucket).upload(
      input.path,
      input.bytes,
      {
        contentType: input.contentType,
        upsert: false,
      },
    );

    if (error !== null) {
      throw new ProviderRetryableError({
        providerName: this.providerName,
        message: `Storage upload başarısız: ${error.message}`,
        code: "PROVIDER_STORAGE_UPLOAD_FAILED",
      });
    }
  }
}
