import type { AssetSigner } from "@vi/application/use-cases/get-generation-detail";
import {
  assertSafeBucketName,
  assertSafeStoragePath,
} from "./storage-path";

export class MockAssetSigner implements AssetSigner {
  public async sign(params: {
    bucket: string;
    path: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    assertSafeBucketName(params.bucket);
    assertSafeStoragePath(params.path);

    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
    const encodedPath = encodeURIComponent(params.path);
    const url = `https://assets.local/${params.bucket}/${encodedPath}?exp=${expiresAt.getTime()}`;
    return {
      url,
      expiresAt,
    };
  }
}
