import BrowserDemoShell from "./browser-demo-shell";

const strategyRows = [
  ["Format", "Magic-byte detection before extension handling"],
  ["PNG", "alpha, palette, area, color count, and source size thresholds"],
  ["JPEG", "DQT source-quality estimate before recompression"],
  ["Candidates", "PNG/JPEG conversion and WebP outputs only when smaller"],
  ["Replacement", "local explicit option, skipped unless the primary output shrinks"],
];

const cliOptions = [
  ["--replace", "replace original paths only after a smaller primary output is produced"],
  ["--no-convert", "disable PNG/JPEG conversion candidates"],
  ["--webp", "write a smaller WebP candidate beside the primary output"],
  ["--quality q1..q6", "apply the old Zhitu quality-button adjustment"],
  ["--json", "emit machine-readable batch results"],
];

export default function Home() {
  return (
    <main>
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-5 grid min-h-[88vh] w-[350px] max-w-[calc(100vw-40px)] gap-10 px-0 py-5 sm:mx-auto sm:w-full sm:max-w-7xl sm:px-5 md:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] md:px-8 md:py-8">
          <div className="flex min-w-0 flex-col">
            <header className="flex items-center justify-between border-b border-zinc-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded bg-zinc-950 text-sm font-semibold text-white">
                  S
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-950">Smartu</p>
                  <p className="text-xs text-zinc-500">Zhitu strategy rebuild</p>
                </div>
              </div>
              <a
                className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-950"
                href="#cli"
              >
                CLI
              </a>
            </header>

            <div className="flex flex-1 flex-col justify-center py-10">
              <h1 className="max-w-2xl text-3xl font-semibold leading-[1.12] tracking-normal text-zinc-950 sm:text-5xl md:text-6xl">
                Local image compression with recovered Zhitu strategy.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-zinc-600 break-words">
                Smartu keeps the strategy in one package, then exposes it through Node, CLI, and browser runtimes.
              </p>

              <div className="mt-10 grid min-w-0 gap-3 sm:grid-cols-2">
                {strategyRows.slice(0, 4).map(([label, value]) => (
                  <div key={label} className="border-l border-zinc-300 pl-4">
                    <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-800 break-words">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <BrowserDemoShell />
        </div>
      </section>

      <section className="bg-zinc-50 px-5 py-16 md:px-8">
        <div className="mx-0 grid max-w-[350px] gap-10 sm:mx-auto sm:max-w-7xl md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-zinc-950">Strategy model</h2>
            <p className="mt-4 text-sm leading-7 text-zinc-600">
              The first implementation target is classification, quality selection, candidate comparison, and
              replacement safety. Codec details stay behind runtime adapters.
            </p>
          </div>
          <div className="overflow-hidden rounded border border-zinc-200 bg-white">
            {strategyRows.map(([label, value]) => (
              <div key={label} className="grid gap-3 border-b border-zinc-200 px-4 py-4 last:border-b-0 md:grid-cols-[140px_1fr]">
                <p className="text-sm font-semibold text-zinc-950">{label}</p>
                <p className="text-sm leading-6 text-zinc-600">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="cli" className="bg-white px-5 py-16 md:px-8">
        <div className="mx-0 grid max-w-[350px] gap-10 sm:mx-auto sm:max-w-7xl md:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-zinc-950">CLI workflow</h2>
            <pre className="mt-6 overflow-x-auto rounded bg-zinc-950 p-5 text-sm leading-7 text-zinc-100">
              <code>{`pnpm build
smartu ./images --out ./compressed --webp
smartu ./images --replace --quality q5
pnpm benchmark:strategy -- --samples ./samples`}</code>
            </pre>
          </div>
          <div className="rounded border border-zinc-200">
            {cliOptions.map(([option, description]) => (
              <div key={option} className="grid gap-3 border-b border-zinc-200 px-4 py-4 last:border-b-0 md:grid-cols-[150px_1fr]">
                <code className="font-mono text-sm font-semibold text-zinc-950">{option}</code>
                <p className="text-sm leading-6 text-zinc-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
