"use client";

import dynamic from "next/dynamic";

const BrowserDemo = dynamic(() => import("./browser-demo"), {
  ssr: false,
  loading: () => (
    <section className="flex min-h-[620px] min-w-0 flex-col rounded border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Browser runtime</h2>
          <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, WebP via shared strategy</p>
        </div>
        <span className="rounded bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
          Loading
        </span>
      </div>
      <div className="mt-4 flex min-h-52 flex-1 items-center justify-center rounded border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
        Preparing browser runtime
      </div>
    </section>
  ),
});

export default function BrowserDemoShell() {
  return <BrowserDemo />;
}
