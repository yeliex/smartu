import {
  compressImage,
  type CompressionOptions,
  type CompressionOutput,
} from "smartu";

interface CompressionWorkerRequest {
  readonly id: string;
  readonly file: File;
  readonly options: CompressionOptions;
}

interface CompressionWorkerOutput {
  readonly blob: Blob;
  readonly format: CompressionOutput["format"];
  readonly reason: string;
  readonly size: number;
  readonly suffix?: string;
}

interface CompressionWorkerSuccess {
  readonly id: string;
  readonly ok: true;
  readonly outputs: readonly CompressionWorkerOutput[];
}

interface CompressionWorkerFailure {
  readonly id: string;
  readonly ok: false;
  readonly error: string;
}

self.onmessage = (event: MessageEvent<CompressionWorkerRequest>) => {
  void compressInWorker(event.data);
};

async function compressInWorker(request: CompressionWorkerRequest) {
  try {
    const result = await compressImage(request.file, request.options);
    const outputs: CompressionWorkerOutput[] = [
      toWorkerOutput(result.primary, result.primaryBlob),
      ...result.alternatives.map((output, index) =>
        toWorkerOutput(output, result.alternativeBlobs[index] ?? result.primaryBlob),
      ),
    ];

    postMessage({
      id: request.id,
      ok: true,
      outputs,
    } satisfies CompressionWorkerSuccess);
  } catch (compressionError) {
    postMessage({
      id: request.id,
      ok: false,
      error: compressionError instanceof Error ? compressionError.message : String(compressionError),
    } satisfies CompressionWorkerFailure);
  }
}

function toWorkerOutput(output: CompressionOutput, blob: Blob): CompressionWorkerOutput {
  return {
    blob,
    format: output.format,
    reason: output.reason,
    size: output.size,
    suffix: output.suffix,
  };
}
