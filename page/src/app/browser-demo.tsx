"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsIcon } from "lucide-react";
import {
  compressImage,
  type CompressionOptions,
  type CompressionOutput,
} from "smartu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DemoOutput {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly format: string;
  readonly reason: string;
}

interface FileRow {
  readonly id: string;
  readonly name: string;
  readonly sourceSize: number;
  readonly outputs: readonly DemoOutput[];
  readonly error?: string;
  readonly processing: boolean;
}

export default function BrowserDemo() {
  const [rows, setRows] = useState<readonly FileRow[]>([]);
  const [allowFormatConversion, setAllowFormatConversion] = useState(true);
  const [generateWebp, setGenerateWebp] = useState(false);
  const [generateAvif, setGenerateAvif] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<readonly FileRow[]>([]);

  const options = useMemo<CompressionOptions>(
    () => ({
      allowFormatConversion,
      generateWebp,
      generateAvif,
      qualityPreset: "q5",
    }),
    [allowFormatConversion, generateAvif, generateWebp],
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    return () => revokeRows(rowsRef.current);
  }, []);

  async function compressFile(nextFile: File, nextOptions: CompressionOptions, id: string) {
    try {
      const result = await compressImage(nextFile, nextOptions);
      const outputs: DemoOutput[] = [
        toDemoOutput(nextFile.name, result.primary, result.primaryBlob),
        ...result.alternatives.map((output, index) =>
          toDemoOutput(nextFile.name, output, result.alternativeBlobs[index] ?? result.primaryBlob),
        ),
      ];

      setRows((currentRows) =>
        currentRows.map((row) =>
          row.id === id
            ? {
                ...row,
                outputs,
                processing: false,
              }
            : row,
        ),
      );
    } catch (compressionError) {
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.id === id
            ? {
                ...row,
                error: compressionError instanceof Error ? compressionError.message : String(compressionError),
                processing: false,
              }
            : row,
        ),
      );
    }
  }

  async function handleFiles(files: FileList | null) {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) {
      return;
    }

    const nextOptions = options;
    const nextRows = nextFiles.map((file, index) => ({
        id: rowId(file, index),
        name: file.name,
        sourceSize: file.size,
        outputs: [],
        processing: true,
      }));

    setRows((currentRows) => [...currentRows, ...nextRows]);

    for (const [index, file] of nextFiles.entries()) {
      await compressFile(file, nextOptions, nextRows[index]?.id ?? rowId(file, index));
    }
  }

  return (
    <Card className="w-full min-w-0 bg-muted/30">
      <CardHeader>
        <CardTitle>Try compress in browser</CardTitle>
        <CardDescription>PNG and JPEG compression with explicit WebP and AVIF candidates.</CardDescription>
        <CardAction>
          <Popover>
            <PopoverTrigger
              render={
                <Button aria-label="Compression settings" size="icon-lg" variant="outline">
                  <SettingsIcon data-icon="inline-start" />
                </Button>
              }
            />
            <PopoverContent align="end">
              <PopoverHeader>
                <PopoverDescription>Settings apply to the next selected file batch.</PopoverDescription>
              </PopoverHeader>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>Format candidates</span>
                <Checkbox
                  checked={allowFormatConversion}
                  onCheckedChange={(checked) => setAllowFormatConversion(checked === true)}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>WebP candidate</span>
                <Checkbox
                  checked={generateWebp}
                  onCheckedChange={(checked) => setGenerateWebp(checked === true)}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>AVIF candidate</span>
                <Checkbox
                  checked={generateAvif}
                  onCheckedChange={(checked) => setGenerateAvif(checked === true)}
                />
              </label>
            </PopoverContent>
          </Popover>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Button
          className="flex min-h-44 flex-col border-dashed text-center"
          onClick={() => inputRef.current?.click()}
          type="button"
          variant="outline"
        >
          <span className="font-semibold">Choose images</span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Settings changes apply to the next selected file batch.
          </span>
        </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="w-24">Source</TableHead>
              <TableHead>Outputs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="min-w-0 max-w-[380px] whitespace-normal break-all">{row.name}</TableCell>
                  <TableCell>{formatSize(row.sourceSize)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {row.processing ? <span className="text-muted-foreground">Processing</span> : null}
                      {row.error ? <span className="text-destructive">{row.error}</span> : null}
                      {row.outputs.map((output) => (
                        <Badge key={`${row.id}-${output.name}`} variant="secondary" render={<a download={output.name} href={output.url} title={output.reason} />}>
                          {output.format} {formatSize(output.size)} {formatCompressionRatio(row.sourceSize, output.size)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={3}>
                  No files selected.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function rowId(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}-${crypto.randomUUID()}`;
}

function revokeRows(rows: readonly FileRow[]) {
  for (const row of rows) {
    for (const output of row.outputs) {
      URL.revokeObjectURL(output.url);
    }
  }
}

function toDemoOutput(sourceName: string, output: CompressionOutput, blob: Blob): DemoOutput {
  return {
    name: outputFileName(sourceName, output),
    url: URL.createObjectURL(blob),
    size: output.size,
    format: output.format,
    reason: output.reason,
  };
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }

  return `${Math.round((size / 1024 / 1024) * 10) / 10} MB`;
}

function formatCompressionRatio(sourceSize: number, outputSize: number): string {
  if (sourceSize <= 0) {
    return "0%";
  }

  const ratio = Math.max(0, 1 - outputSize / sourceSize);
  return `${Math.round(ratio * 1000) / 10}%`;
}

function outputFileName(sourceName: string, output: CompressionOutput): string {
  const dotIndex = sourceName.lastIndexOf(".");
  const basename = dotIndex >= 0 ? sourceName.slice(0, dotIndex) : sourceName;
  return `${basename}${output.suffix ?? ""}.${output.format}`;
}
