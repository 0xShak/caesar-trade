import { describe, expect, it } from "vitest";
import { isAddress, getAddress } from "viem";
import {
  WalletSetupStep,
  WALLET_SETUP_SEQUENCE,
  nextSetupStep,
  walletSetupProgress,
  deriveTradingWallet,
  requiredApprovals,
  encodeErc20Approve,
  encodeErc1155SetApprovalForAll,
  buildClobAuthTypedData,
  type WalletSetupFlags,
} from "./wallet-setup.js";
import { SignatureType } from "./eip712.js";
import { POLYGON_CHAIN_ID } from "./addresses.js";

const NONE: WalletSetupFlags = {
  hasServerSigner: false,
  isSafeDeployed: false,
  hasV1Approvals: false,
  hasV2Approvals: false,
  hasApiCredentials: false,
};
const ALL: WalletSetupFlags = {
  hasServerSigner: true,
  isSafeDeployed: true,
  hasV1Approvals: true,
  hasV2Approvals: true,
  hasApiCredentials: true,
};

// A fixed owner so derivation assertions are regression-locked (lock the bundle
// factory + init-code hashes against accidental edits).
const OWNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;

describe("wallet-setup state machine", () => {
  it("starts at CONNECT_WALLET with nothing done", () => {
    expect(nextSetupStep(NONE)).toBe(WalletSetupStep.CONNECT_WALLET);
  });

  it("returns COMPLETE when every flag is set", () => {
    expect(nextSetupStep(ALL)).toBe(WalletSetupStep.COMPLETE);
  });

  it("advances strictly in sequence as each flag flips", () => {
    const flags = { ...NONE };
    const seen: WalletSetupStep[] = [];
    for (const expected of WALLET_SETUP_SEQUENCE) {
      expect(nextSetupStep(flags)).toBe(expected);
      seen.push(expected);
      // flip the flag this step depends on
      if (expected === WalletSetupStep.CONNECT_WALLET) flags.hasServerSigner = true;
      else if (expected === WalletSetupStep.DEPLOY_SAFE) flags.isSafeDeployed = true;
      else if (expected === WalletSetupStep.SET_V1_APPROVALS) flags.hasV1Approvals = true;
      else if (expected === WalletSetupStep.SET_V2_APPROVALS) flags.hasV2Approvals = true;
      else if (expected === WalletSetupStep.DERIVE_API_KEY) flags.hasApiCredentials = true;
    }
    expect(nextSetupStep(flags)).toBe(WalletSetupStep.COMPLETE);
    expect(seen).toEqual([...WALLET_SETUP_SEQUENCE]);
  });

  it("reports progress snapshot at a partial state", () => {
    const p = walletSetupProgress({ ...NONE, hasServerSigner: true, isSafeDeployed: true });
    expect(p).toMatchObject({
      step: WalletSetupStep.SET_V1_APPROVALS,
      stepIndex: 2,
      totalSteps: 5,
      isComplete: false,
    });
    expect(p.completedSteps).toEqual([
      WalletSetupStep.CONNECT_WALLET,
      WalletSetupStep.DEPLOY_SAFE,
    ]);
  });

  it("marks complete with stepIndex at the sequence length", () => {
    const p = walletSetupProgress(ALL);
    expect(p.isComplete).toBe(true);
    expect(p.stepIndex).toBe(WALLET_SETUP_SEQUENCE.length);
    expect(p.completedSteps).toHaveLength(WALLET_SETUP_SEQUENCE.length);
  });
});

describe("funder-wallet derivation", () => {
  it("derives a deterministic Gnosis Safe (default kind)", () => {
    const w = deriveTradingWallet(OWNER);
    expect(w.kind).toBe("safe");
    expect(w.signatureType).toBe(SignatureType.POLY_GNOSIS_SAFE);
    expect(isAddress(w.address)).toBe(true);
    // Regression lock — recomputed from the bundle's safeFactory + init hash.
    expect(w.address).toBe(getAddress("0xfDABD6595EE5ebc795e9e36C62C11F00CCd676C9"));
  });

  it("derives a deterministic Polymarket proxy wallet", () => {
    const w = deriveTradingWallet(OWNER, "proxy");
    expect(w.kind).toBe("proxy");
    expect(w.signatureType).toBe(SignatureType.POLY_PROXY);
    expect(w.address).toBe(getAddress("0x60a66958b3971D609e4fd831f66A1579c9853a51"));
  });

  it("safe and proxy addresses differ for the same owner", () => {
    expect(deriveTradingWallet(OWNER, "safe").address).not.toBe(
      deriveTradingWallet(OWNER, "proxy").address,
    );
  });
});

describe("approval calldata", () => {
  it("encodes ERC20 approve / ERC1155 setApprovalForAll selectors", () => {
    expect(encodeErc20Approve(OWNER).slice(0, 10)).toBe("0x095ea7b3");
    expect(encodeErc1155SetApprovalForAll(OWNER).slice(0, 10)).toBe("0xa22cb465");
  });

  it("lists USDC + CTF approvals for each V1 / V2 spender", () => {
    for (const version of ["v1", "v2"] as const) {
      const txs = requiredApprovals(POLYGON_CHAIN_ID, version);
      expect(txs).toHaveLength(4); // 2 spenders × (erc20 + erc1155)
      expect(txs.filter((t) => t.tokenStandard === "erc20")).toHaveLength(2);
      expect(txs.filter((t) => t.tokenStandard === "erc1155")).toHaveLength(2);
      expect(txs.every((t) => t.version === version)).toBe(true);
      // each spender appears exactly once per token standard
      expect(new Set(txs.map((t) => t.spender)).size).toBe(2);
    }
  });
});

describe("ClobAuth typed data", () => {
  it("builds the L1 login payload with the canonical message + domain", () => {
    const td = buildClobAuthTypedData(OWNER, POLYGON_CHAIN_ID, "1700000000");
    expect(td.primaryType).toBe("ClobAuth");
    expect(td.domain).toMatchObject({ name: "ClobAuthDomain", version: "1", chainId: POLYGON_CHAIN_ID });
    expect(td.domain).not.toHaveProperty("verifyingContract");
    expect(td.message).toMatchObject({
      address: OWNER,
      timestamp: "1700000000",
      nonce: 0n,
      message: "This message attests that I control the given wallet",
    });
  });
});
