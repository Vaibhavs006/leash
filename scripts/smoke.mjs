/**
 * Smoke test against a RUNNING Leash server (local or deployed). No dependencies.
 *
 *   npm run smoke                                  # http://localhost:3000
 *   npm run smoke -- https://leash.onrender.com    # deployed site
 *
 * Safe in live mode: it never triggers a live agent run or a live payment. Flows that
 * would move (sandbox) money only run when payments are in offline-simulator mode.
 */
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
let failures = 0;
const pass = (m) => console.log(`\x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => {
  failures++;
  console.log(`\x1b[31mFAIL\x1b[0m ${m}`);
};
const check = (cond, m) => (cond ? pass(m) : fail(m));

function visitor() {
  let cookie = "";
  return async (path, init = {}) => {
    const res = await fetch(BASE + path, {
      ...init,
      redirect: "manual",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("leash_ws=")) cookie = set.split(";")[0];
    return res;
  };
}
const body = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  const health = await fetch(`${BASE}/api/health`).then(body);
  check(health.ok === true && health.database === true, `health ok, database reachable (commit ${health.commit})`);
  const modes = health.modes ?? {};
  console.log(`     modes: catalog=${modes.catalog} agent=${modes.agent} payments=${modes.payments}`);

  const a = visitor();
  const b = visitor();
  const page = await a("/");
  const html = await page.text();
  check(page.status === 200 && html.includes("Leash"), "dashboard renders for a new visitor");
  check(page.headers.get("x-frame-options") === "DENY" && page.headers.get("x-content-type-options") === "nosniff", "security headers present");

  const sa = await a("/api/state").then(body);
  const sb = await b("/api/state").then(body);
  check(sa.workspace?.id && sb.workspace?.id && sa.workspace.id !== sb.workspace.id, "each visitor gets an isolated workspace");
  check(!!sa.mandates?.[0]?.id, "default mandate seeded");

  const reset0 = await a("/api/demo/reset", { method: "POST" });
  check(reset0.status === 200, "reset demo (start clean)");
  // Reset replaces the mandate, so read its new id.
  const mandateId = (await a("/api/state").then(body)).mandates?.[0]?.id;

  const hj = await a("/api/demo/hijack", { method: "POST", body: JSON.stringify({ mandateId }) });
  const afterHj = await a("/api/state").then(body);
  const denied = afterHj.purchases?.find((p) => p.status === "denied");
  check(hj.status === 201 && denied && !denied.paypalOrderId, "hijacked agent is blocked and no payment is attempted");

  const foreign = await b(`/api/purchases/${denied?.id}/approve`, { method: "POST" });
  check(foreign.status === 404, "another visitor cannot act on this purchase");

  const xo = await a("/api/demo/reset", { method: "POST", headers: { Origin: "https://evil.example" } });
  check(xo.status === 403, "cross-origin POST rejected");

  if (modes.payments === "simulated") {
    await a("/api/demo/reset", { method: "POST" });
    const sample = await a("/api/demo/sample", { method: "POST" });
    const st = await a("/api/state").then(body);
    const statuses = (st.purchases ?? []).map((p) => p.status);
    check(sample.status === 201 && statuses.includes("captured") && statuses.includes("denied") && statuses.includes("pending_approval"), `sample history via simulated agent (${statuses.join(", ")})`);

    const pending = st.purchases.find((p) => p.status === "pending_approval");
    const ap = await a(`/api/purchases/${pending.id}/approve`, { method: "POST" }).then(body);
    check(typeof ap.approveUrl === "string" && ap.approveUrl.includes("/demo/approve"), "approval goes to the offline payment simulator");
    const ret = await a(`/api/paypal/return?purchase=${pending.id}&token=${encodeURIComponent(ap.purchase.paypalOrderId)}`);
    const st2 = await a("/api/state").then(body);
    const done = st2.purchases.find((p) => p.id === pending.id);
    check(ret.status >= 300 && ret.status < 400 && done.status === "captured", "simulated approval captured");

    const rf = await a(`/api/purchases/${pending.id}/refund`, { method: "POST" }).then(body);
    check(rf.purchase?.status === "refunded", "refund recorded and budget restored");
  } else {
    console.log("     (payments are live: skipping flows that would create sandbox payments)");
  }

  const reset = await a("/api/demo/reset", { method: "POST" });
  const st3 = await a("/api/state").then(body);
  check(reset.status === 200 && st3.purchases?.length === 0 && st3.runs?.length === 0 && st3.mandates?.length === 1, "reset demo clears runs and ledger, restores mandate");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
