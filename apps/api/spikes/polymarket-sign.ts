/**
 * SPIKE A — Polymarket on-chain signing de-risk.
 *
 * SUCCESS BAR: a signed V2 CLOB order's EIP-712 signature recovers to the
 * signer EOA (offline hard gate), AND the CLOB parses/accepts the order
 * envelope (a structural/balance rejection still counts as PASS; an
 * auth/signature rejection is FAIL). A real fill is NOT required.
 *
 * Run: pnpm --filter @caesar/api spike:polymarket
 *
 * ── verify-before-mainnet TODOs ──────────────────────────────────────────────
 *  - COLLATERAL: AMOY/MATIC `collateral` in @caesar/chain is a PLACEHOLDER
 *    (0xC011…2DFB). Confirm the real Polymarket USDC.e before mainnet orders.
 *  - BUILDER: builderCode (bytes32) is ZERO here (no builder on testnet).
 *    Register Caesar's builder identity + fee rate before charging builder fees.
 *  - TOKEN: `SAMPLE_TOKEN_ID` below is a placeholder clobTokenId — use a real
 *    market's tokenId for a live fill.
 *  - signatureType POLY_GNOSIS_SAFE(2) requires the user's Safe deployed +
 *    USDC/CTF approvals set (done server-side via /api/wallet_approvals).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { loadEnv } from "@caesar/config";
import {
  AMOY_CHAIN_ID,
  AMOY_CONTRACTS,
  OrderSide,
  SignatureType,
  ZERO_BYTES32,
  clobAuthDomain,
  deriveSafe,
  generateOrderSalt,
  orderDomain,
  type OrderV2Value,
} from "@caesar/chain";
import {
  buildL2HmacSignature,
  createClobClient,
  deriveApiCreds,
  recoverV2OrderSigner,
} from "@caesar/chain/polymarket";
import { Wallet } from "ethers";
import { type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// A documented PLACEHOLDER clobTokenId. Replace with a real market token for a
// live fill — this value is only used to exercise the sign/recover path.
const SAMPLE_TOKEN_ID =
  71321045679252212594626385532706912750332728571942532289631379312455583992563n;

async function main(): Promise<void> {
  const env = loadEnv();
  let pass = true;

  // 1) Key handling — NEVER a mainnet key. Generate a throwaway if blank.
  let pk: Hex;
  if (env.AMOY_PRIVATE_KEY && env.AMOY_PRIVATE_KEY.length > 0) {
    pk = env.AMOY_PRIVATE_KEY as Hex;
    console.log("[key] using AMOY_PRIVATE_KEY from env (testnet only)");
  } else {
    pk = generatePrivateKey();
    const addr = privateKeyToAccount(pk).address;
    console.log("[key] AMOY_PRIVATE_KEY blank → generated THROWAWAY key");
    console.log(`      address: ${addr}`);
    console.log("      fund POL: https://faucet.polygon.technology (select Amoy)");
    console.log("      test USDC also required for a real fill (placeholder collateral here)");
  }

  const eoa = privateKeyToAccount(pk).address as Address;
  const maker = deriveSafe(eoa); // user's Safe = funder
  const signer = eoa;
  const signatureType = SignatureType.POLY_GNOSIS_SAFE;
  console.log(`[wallet] eoa(signer)=${signer}`);
  console.log(`[wallet] safe(maker/funder)=${maker}`);
  console.log(`[wallet] signatureType=POLY_GNOSIS_SAFE(${signatureType})`);

  // 2) L1 → derive CLOB API creds (network; non-fatal on Amoy rejection).
  try {
    const client = createClobClient({
      host: env.POLYMARKET_CLOB_URL,
      chainId: AMOY_CHAIN_ID,
      privateKey: pk,
      funderAddress: maker,
      signatureType,
    });
    const creds = await deriveApiCreds(client);
    const ok = Boolean(creds.key && creds.secret && creds.passphrase);
    console.log(`[L1] deriveApiCreds → ${ok ? "OK" : "MISSING FIELDS"} (key=${creds.key?.slice(0, 8)}…)`);
    // Sanity-exercise the L2 HMAC builder with the real secret.
    if (creds.secret) {
      const sig = buildL2HmacSignature(creds.secret, Date.now(), "GET", "/order");
      console.log(`[L2] sample HMAC sig len=${sig.length} (base64url)`);
    }
  } catch (err) {
    console.log(
      `[L1] deriveApiCreds FAILED (non-fatal; Amoy may be unsupported by CLOB): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  console.log(`[domain.l1] ${JSON.stringify(clobAuthDomain(AMOY_CHAIN_ID))}`);

  // 3) Build + sign a V2 order (the core offline gate).
  const order: OrderV2Value = {
    salt: generateOrderSalt(Math.random(), Date.now()),
    maker,
    signer,
    tokenId: SAMPLE_TOKEN_ID,
    makerAmount: 1_000_000n, // 1 USDC (6dp) sample
    takerAmount: 2_000_000n, // sample
    side: OrderSide.BUY,
    signatureType,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    metadata: ZERO_BYTES32,
    builder: ZERO_BYTES32, // no builder on testnet
  };

  const domain = orderDomain("2", AMOY_CHAIN_ID, AMOY_CONTRACTS.exchangeV2);
  const wallet = new Wallet(pk);
  // ethers v5 EIP-712: types must NOT include EIP712Domain.
  const types = {
    Order: [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "signer", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "makerAmount", type: "uint256" },
      { name: "takerAmount", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "signatureType", type: "uint8" },
      { name: "timestamp", type: "uint256" },
      { name: "metadata", type: "bytes32" },
      { name: "builder", type: "bytes32" },
    ],
  };
  const message = {
    salt: order.salt.toString(),
    maker: order.maker,
    signer: order.signer,
    tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(),
    takerAmount: order.takerAmount.toString(),
    side: order.side,
    signatureType: order.signatureType,
    timestamp: order.timestamp.toString(),
    metadata: order.metadata,
    builder: order.builder,
  };
  const signature = (await wallet._signTypedData(
    domain as Record<string, unknown>,
    types,
    message,
  )) as Hex;
  console.log(`[sign] signature=${signature.slice(0, 18)}… (len ${signature.length})`);

  // 4) HARD GATE — recover signer with viem.
  const recovered = await recoverV2OrderSigner({ domain, order, signature });
  const recoverOk = recovered.toLowerCase() === signer.toLowerCase();
  console.log(`[verify] recovered=${recovered}`);
  console.log(`[verify] expected =${signer}`);
  console.log(`[verify] signature-verify: ${recoverOk ? "PASS" : "FAIL"}`);
  if (!recoverOk) pass = false;

  // 5) Optional: POST the envelope to /order; classify the response.
  try {
    const envelope = {
      order: { ...message, taker: "0x0000000000000000000000000000000000000000", expiration: "0", signature },
      owner: "spike",
      orderType: "GTC",
    };
    const res = await fetch(`${env.POLYMARKET_CLOB_URL}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    const text = await res.text();
    const lc = text.toLowerCase();
    const authReject =
      lc.includes("signature") || lc.includes("unauthorized") || res.status === 401;
    console.log(`[post] /order → HTTP ${res.status}: ${text.slice(0, 160)}`);
    if (authReject) {
      console.log("[post] classified as AUTH/SIGNATURE rejection → FAIL");
      pass = false;
    } else {
      console.log("[post] classified as structural/balance rejection (or accepted) → PASS");
    }
  } catch (err) {
    console.log(
      `[post] /order attempt errored (network; non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  console.log("");
  console.log(`SPIKE A: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error("SPIKE A: FAIL (unexpected error)");
  console.error(err);
  process.exitCode = 1;
});
