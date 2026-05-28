import BrowserDemoShell from "./browser-demo-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const navLinks = [
  ["Playground", "#playground"],
  ["CLI", "#cli"],
  ["NPM", "#npm"],
  ["GitHub", "https://github.com/yeliex/smartu"],
];

const heroPoints = [
  "Actual image format detection instead of extension-only handling.",
  "Shared strategy model for browser, Node.js, and CLI workflows.",
  "Candidate comparison keeps the source when compression is not smaller.",
];

const strategyCards = [
  ["Detection", "Reads the real image format before choosing a compression branch."],
  ["PNG", "Uses alpha, palette, area, color count, and source size thresholds."],
  ["JPEG", "Estimates source quality before selecting recompression quality."],
  ["Candidates", "Tries PNG/JPEG conversion and WebP outputs only when requested and smaller."],
  ["Replacement", "Keeps original-file replacement explicit and size-gated."],
  ["Runtime split", "Node uses Sharp; browser compression stays on shared strategy and web codecs."],
];

const cliOptions = [
  ["<inputs...>", "input files or directories"],
  ["-o, --out <dir>", "write output files to a directory"],
  ["--replace", "replace the original path only when the primary output is smaller"],
  ["--recursive", "recurse into input directories"],
  [
    "--format <formats>",
    "comma-separated output formats: auto,png,jpg,jpeg,webp; default keeps source format. auto tries PNG/JPEG conversion only, WebP requires webp",
  ],
  ["-q, --quality <quality>", "quality mode: auto, q1..q6, or a numeric adjustment"],
  ["--json", "print machine-readable results"],
  ["-h, --help", "display help for command"],
];

const cliCommands = `npx smartu ./images --out ./compressed
npx smartu ./images --format auto,webp --recursive
npx smartu ./images --replace
npx smartu ./images --json`;

const browserCode = `import { compressImage } from "smartu";

const result = await compressImage(file, {
  allowFormatConversion: true,
  generateWebp: true,
});

const url = URL.createObjectURL(result.primaryBlob);`;

const nodeCode = `import { readFile, writeFile } from "node:fs/promises";
import { compressImage } from "smartu";

const input = await readFile("input.png");
const result = await compressImage(input);

await writeFile("output.png", result.primary.buffer);`;

const apiRows = [
  ["compressImage(input, options?)", "Compresses an image and returns metadata, the chosen strategy plan, the primary output, and any smaller alternatives. Browser results also include Blob handles for object URLs."],
  ["analyzeImage(input)", "Reads the actual encoded format, dimensions, source size, color count, alpha signal, PNG8 signal, and JPEG quality estimate."],
  ["createCompressionPlan(metadata, options?)", "Builds the strategy plan without encoding outputs, which is useful when callers need to inspect routing decisions before running codecs."],
];

const optionRows = [
  ["formats", "Optional candidate list using auto, png, jpg, gif, or webp. When omitted, Smartu uses auto and keeps the source format as the primary path."],
  ["allowFormatConversion", "Controls PNG/JPEG conversion candidates in auto mode. It defaults to true, while encoded outputs are still kept only when smaller."],
  ["generateWebp", "Adds a WebP candidate beside the primary strategy output. WebP is opt-in instead of implied by auto."],
  ["qualityPreset", "Accepts q1 through q6 as strategy offsets. q5 is neutral; other presets make branch-selected quality more or less aggressive."],
  ["qualityAdjustment", "A numeric quality offset for callers that need direct tuning. When provided, it takes precedence over qualityPreset."],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
          <a className="flex items-center gap-3" href="#">
            <span className="grid size-9 place-items-center rounded bg-zinc-950 text-sm font-semibold text-white">
              S
            </span>
            <span>
              <span className="block text-sm font-semibold">Smartu</span>
              <span className="block text-xs text-zinc-500">Open image compression toolkit</span>
            </span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex">
            {navLinks.map(([label, href]) => (
              <a key={label} className="transition hover:text-zinc-950" href={href}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <section className="border-b border-zinc-200">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col gap-10 px-5 py-10 md:px-8 md:py-14">
          <div className="flex min-w-0 flex-col">
            <h1 className="max-w-2xl text-5xl font-semibold leading-[0.98] tracking-normal text-zinc-950 sm:text-6xl md:text-7xl">
              Smartu
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 text-zinc-700">
              Intelligent image compression inspired by Zhitu, rebuilt for open-source browser, Node.js,
              CLI, website, and build-pipeline workflows.
            </p>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600">
              Smartu focuses on the decision layer around compression: how an image is classified, when
              format conversion is worth trying, which quality level to use, and when to preserve the
              source because the result is not better.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              <code className="max-w-full break-all rounded border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-zinc-950">
                npx smartu@latest ./
              </code>
              <span>or</span>
              <code className="max-w-full break-all rounded border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-zinc-950">
                npx skills add https://github.com/yeliex/smartu -g
              </code>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button render={<a href="#playground" />} size="lg">
                Try online
              </Button>
              <Button render={<a href="#npm" />} size="lg" variant="outline">
                Developer doc
              </Button>
            </div>
            <Button className="mt-3 w-fit px-0" render={<a href="https://github.com/yeliex/smartu" />} variant="link">
              View source on GitHub
            </Button>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {heroPoints.map((point) => (
                <div key={point} className="border-l border-zinc-300 pl-4">
                  <p className="text-sm leading-6 text-zinc-700">{point}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="playground" className="flex min-w-0 scroll-mt-24">
            <BrowserDemoShell />
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-200 bg-zinc-50 px-5 py-16 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-normal text-zinc-950">Compression strategy</h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Smartu inspects each image, selects a compression path, evaluates conversion candidates,
              and keeps the source when the compressed result is not smaller.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {strategyCards.map(([title, description]) => (
              <Card key={title} size="sm">
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="cli" className="border-b border-zinc-200 bg-white px-5 py-16 scroll-mt-20 md:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-semibold tracking-normal text-zinc-950">CLI for local batches</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
            Compress files or directories into an output folder, try conversion candidates, or replace
            originals only after Smartu proves the primary output is smaller.
          </p>
          <pre className="mt-8 overflow-x-auto rounded bg-zinc-950 p-5 text-sm leading-7 text-zinc-100">
            <code>{cliCommands}</code>
          </pre>
          <Table className="mt-6">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Argument / option</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cliOptions.map(([option, description]) => (
                <TableRow key={option}>
                  <TableCell className="whitespace-normal">
                    <code className="font-mono text-sm font-semibold">{option}</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section id="npm" className="bg-white px-5 py-16 scroll-mt-20 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-normal text-zinc-950">Use the same API from npm</h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Install one package and import from the root entrypoint. Conditional exports select the
              Sharp-based Node runtime or the Canvas-based browser runtime.
            </p>
          </div>

          <section className="mt-8">
            <h3 className="text-base font-semibold text-zinc-950">Installation</h3>
            <pre className="mt-3 overflow-x-auto rounded bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900">
              <code>npm install smartu</code>
            </pre>
          </section>

          <div className="mt-10 grid gap-5">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Browser</CardTitle>
              </CardHeader>
              <CardContent>
              <pre className="overflow-x-auto text-sm leading-7 text-zinc-900">
                <code>{browserCode}</code>
              </pre>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Node.js</CardTitle>
              </CardHeader>
              <CardContent>
              <pre className="overflow-x-auto text-sm leading-7 text-zinc-900">
                <code>{nodeCode}</code>
              </pre>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 grid gap-8">
            <section className="min-w-0">
              <div>
                <h3 className="text-base font-semibold text-zinc-950">API reference</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Browser and Node resolve different runtime adapters, but keep the same main API names.
                </p>
              </div>
              {apiRows.map(([name, description]) => (
                <div
                  key={name}
                  className="mt-5 border-l border-zinc-300 pl-4"
                >
                  <code className="font-mono text-sm font-semibold text-zinc-950">{name}</code>
                  <p className="text-sm leading-6 text-zinc-600">{description}</p>
                </div>
              ))}
            </section>

            <section className="min-w-0">
              <div>
                <h3 className="text-base font-semibold text-zinc-950">CompressionOptions</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Options tune candidate generation and quality offsets; runtimes still compare encoded sizes.
                </p>
              </div>
              {optionRows.map(([name, description]) => (
                <div
                  key={name}
                  className="mt-5 border-l border-zinc-300 pl-4"
                >
                  <code className="font-mono text-sm font-semibold text-zinc-950">{name}</code>
                  <p className="text-sm leading-6 text-zinc-600">{description}</p>
                </div>
              ))}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
