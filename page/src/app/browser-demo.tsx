"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  compressImage,
  type CompressionOutput,
  type CompressionOptions,
} from "smartu";

type BrowserCompressionResult = Awaited<ReturnType<typeof compressImage>>;

interface DemoOutput {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly kind: string;
}

export default function BrowserDemo() {
  const [file, setFile] = useState<File | undefined>();
  const [result, setResult] = useState<BrowserCompressionResult | undefined>();
  const [outputs, setOutputs] = useState<readonly DemoOutput[]>([]);
  const [allowFormatConversion, setAllowFormatConversion] = useState(true);
  const [generateWebp, setGenerateWebp] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo<CompressionOptions>(
    () => ({
      allowFormatConversion,
      generateWebp,
      qualityPreset: "q5",
    }),
    [allowFormatConversion, generateWebp],
  );

  useEffect(() => {
    return () => {
      for (const output of outputs) {
        URL.revokeObjectURL(output.url);
      }
    };
  }, [outputs]);

  async function runCompression(nextFile: File) {
    setStatus("Processing");
    setError(undefined);
    setResult(undefined);
    setOutputs((currentOutputs) => {
      for (const output of currentOutputs) {
        URL.revokeObjectURL(output.url);
      }
      return [];
    });

    try {
      const nextResult = await compressImage(nextFile, options);
      const nextOutputs: DemoOutput[] = [
        {
          name: outputFileName(nextFile.name, nextResult.primary),
          url: URL.createObjectURL(nextResult.primaryBlob),
          size: nextResult.primary.size,
          kind: nextResult.primary.kind,
        },
        ...nextResult.alternatives.map((output, index) => ({
          name: outputFileName(nextFile.name, output),
          url: URL.createObjectURL(nextResult.alternativeBlobs[index] ?? nextResult.primaryBlob),
          size: output.size,
          kind: output.kind,
        })),
      ];

      setResult(nextResult);
      setOutputs(nextOutputs);
      setStatus(nextResult.primary.compressed ? "Compressed" : "Kept original");
    } catch (compressionError) {
      setError(compressionError instanceof Error ? compressionError.message : String(compressionError));
      setStatus("Failed");
    }
  }

  async function handleFiles(files: FileList | null) {
    const nextFile = files?.item(0);
    if (!nextFile) {
      return;
    }

    setFile(nextFile);
    await runCompression(nextFile);
  }

  return (
    <section className="flex min-h-[620px] min-w-0 flex-col rounded border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Browser runtime</h2>
          <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, WebP via shared strategy</p>
        </div>
        <span className="rounded bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
          {status}
        </span>
      </div>

      <button
        className="mt-4 flex min-h-52 flex-1 flex-col items-center justify-center rounded border border-dashed border-zinc-300 bg-white px-4 text-center transition hover:border-zinc-500"
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <span className="grid size-11 place-items-center rounded bg-zinc-950 text-lg font-semibold text-white">
          +
        </span>
        <span className="mt-4 text-sm font-semibold text-zinc-950">
          {file ? file.name : "Choose an image"}
        </span>
        <span className="mt-2 max-w-xs text-xs leading-5 text-zinc-500">
          The file stays in this browser session.
        </span>
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between rounded border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-700">
          <span>Format candidates</span>
          <input
            checked={allowFormatConversion}
            className="size-4 accent-zinc-950"
            onChange={(event) => setAllowFormatConversion(event.currentTarget.checked)}
            type="checkbox"
          />
        </label>
        <label className="flex items-center justify-between rounded border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-700">
          <span>WebP candidate</span>
          <input
            checked={generateWebp}
            className="size-4 accent-zinc-950"
            onChange={(event) => setGenerateWebp(event.currentTarget.checked)}
            type="checkbox"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded border border-zinc-200 bg-white">
          <div className="grid grid-cols-3 border-b border-zinc-200 px-3 py-3 text-xs font-semibold uppercase text-zinc-500">
            <span>Branch</span>
            <span>Source</span>
            <span>Output</span>
          </div>
          <div className="grid grid-cols-3 px-3 py-3 text-sm text-zinc-800">
            <span>{result.plan.branch}</span>
            <span>{formatSize(result.metadata.size)}</span>
            <span>{formatSize(result.primary.size)}</span>
          </div>
          {outputs.map((output) => (
            <a
              key={`${output.kind}-${output.name}`}
              className="flex items-center justify-between border-t border-zinc-200 px-3 py-3 text-sm text-zinc-800 transition hover:bg-zinc-50"
              download={output.name}
              href={output.url}
            >
              <span className="min-w-0 break-all pr-3">{output.name}</span>
              <span className="text-zinc-500">{formatSize(output.size)}</span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }

  return `${Math.round((size / 1024 / 1024) * 10) / 10} MB`;
}

function outputFileName(sourceName: string, output: CompressionOutput): string {
  const dotIndex = sourceName.lastIndexOf(".");
  const basename = dotIndex >= 0 ? sourceName.slice(0, dotIndex) : sourceName;
  return `${basename}${output.suffix ?? ""}.${output.format}`;
}
