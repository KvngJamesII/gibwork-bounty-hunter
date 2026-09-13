/**
 * Optional wallet-authenticated Gibwork SDK client.
 * Requires Node >=22 and GIBWORK_PRIVATE_KEY or GIBWORK_KEYPAIR_PATH.
 * Never prompts for Phantom / browser wallet signatures.
 */

export async function tryCreateSdkClient(): Promise<
  | { ok: true; client: Awaited<ReturnType<typeof loadClient>>; walletHint: string }
  | { ok: false; reason: string }
> {
  const key = process.env.GIBWORK_PRIVATE_KEY?.trim();
  const path = process.env.GIBWORK_KEYPAIR_PATH?.trim();
  if (!key && !path) {
    return {
      ok: false,
      reason:
        "No GIBWORK_PRIVATE_KEY or GIBWORK_KEYPAIR_PATH set — using public API only (discovery still works).",
    };
  }

  let privateKey: string = key ?? "";
  if (!privateKey && path) {
    const { readFile } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const resolved = path.replace(/^~(?=\/|$)/, homedir());
    privateKey = (await readFile(resolved, "utf8")).trim();
  }

  try {
    const client = await loadClient(privateKey);
    return { ok: true, client, walletHint: "local-keypair" };
  } catch (err) {
    return {
      ok: false,
      reason: `SDK client failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function loadClient(privateKey: string) {
  const production = (process.env.GIBWORK_PRODUCTION ?? "true") !== "false";
  const { createGibworkClient } = await import("@gibwork/sdk/node");
  return createGibworkClient({ privateKey, production });
}
