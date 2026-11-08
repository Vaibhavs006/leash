import Link from "next/link";
import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <Logo className="mx-auto h-8 w-8" />
        <h1 className="mt-3 text-base font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">This page doesn&apos;t exist.</p>
        <Link href="/" className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-slate-800">
          Back to Leash
        </Link>
      </div>
    </main>
  );
}
