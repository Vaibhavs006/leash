"use client";

import { useEffect } from "react";
import { Logo } from "@/components/ui";

/** Route-level error boundary: a readable message and a retry instead of a blank page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <Logo className="mx-auto h-8 w-8" />
        <h1 className="mt-3 text-base font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">Leash hit an unexpected error. Try again, or reload the page if it keeps happening.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-slate-400">ref {error.digest}</p>}
        <button onClick={reset} className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-slate-800">
          Try again
        </button>
      </div>
    </main>
  );
}
