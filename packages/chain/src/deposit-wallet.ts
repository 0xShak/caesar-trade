import {
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  hashStruct,
  keccak256,
  maxUint256,
  padHex,
  stringToHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import {
  CLOB_AUTH_TYPE,
  CTF_EXCHANGE_V2_ORDER,
  ZERO_BYTES32,
  type OrderV2Value,
} from "./eip712.js";
import { COLLATERAL_PUSD_V2, contractsForChain, type SupportedChainId } from "./addresses.js";

/**
 * Polymarket **CLOB V2 deposit wallet** (signatureType 3) — derivation + the
 * ERC-7739 nested-EIP-712 signing scheme its on-chain ERC-1271 validator expects.
 *
 * Source of truth: the VERIFIED on-chain contracts (Sourcify, Polygon mainnet):
 *   - DepositWalletFactory  0x00000000000Fb5C9ADea0298D729A0CB3823Cc07
 *       deploy()  => LibClone.deployDeterministicERC1967(
 *                      impl, args = abi.encode(factory, id), salt = keccak256(args))
 *       id = bytes32(owner); impl = factory.implementation()
 *   - DepositWallet impl    0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB
 *       Solady ERC1271 (nested EIP-712 / ERC-7739); EIP-712 domain
 *       {name:"DepositWallet", version:"1", chainId, verifyingContract: wallet, salt:0};
 *       validation is ALWAYS ECDSA against owner() (the Privy embedded EOA).
 *
 * Everything here is PURE (viem + node) — no network, no mainnet writes. The
 * derivation reproduces `factory.predictWalletAddress(impl, id)` exactly and is
 * regression-locked against the SDK vector in deposit-wallet.test.ts.
 */

// --- Addresses (Polygon mainnet, CONFIRMED on-chain) ------------------------

/** Deterministic deposit-wallet factory (chain-agnostic address). */
export const DEPOSIT_WALLET_FACTORY: Address = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";

/**
 * Current default wallet implementation (= `factory.implementation()` on
 * Polygon, 2026-06). The factory bakes this into each proxy's ERC-1967 slot.
 * Pass an override to `deriveDepositWalletAddress` if the factory rotates it
 * (read `implementation()` at runtime to stay current).
 */
export const DEPOSIT_WALLET_IMPL: Address = "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";

/** Deposit-wallet EIP-712 domain (Solady ERC1271 on the impl above). */
export const DEPOSIT_WALLET_DOMAIN_NAME = "DepositWallet";
export const DEPOSIT_WALLET_DOMAIN_VERSION = "1";

// --- Deterministic address derivation (CREATE2, LibClone ERC-1967 + args) ----

/** Wallet id for an owner: `bytes32(owner)` (address left-padded to 32 bytes). */
export function depositWalletId(owner: Address): Hex {
  return padHex(owner.toLowerCase() as Hex, { size: 32 });
}

/**
 * ABI-encoded ERC-1967 immutable args the factory appends to each proxy:
 * `abi.encode(address factory, bytes32 id)`. Also the CREATE2 salt preimage.
 */
function depositWalletArgs(owner: Address): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [DEPOSIT_WALLET_FACTORY, depositWalletId(owner)],
  );
}

/**
 * keccak256 of the ERC-1967-with-immutable-args creation code, transcribed
 * VERBATIM from Solady `LibClone.initCodeERC1967` (the exact byte layout the
 * factory deploys). `args` is appended to the runtime, so the hash is per-owner.
 *
 *   creation = PUSH2(runtimeLen) ‖ 3d8160233d3973 ‖ impl(20) ‖ 6009
 *            ‖ 5155f3363d3d373d3d363d7f ‖ <eip1967 impl slot 32>
 *            ‖ <delegatecall suffix 20> ‖ args
 * where runtimeLen = 0x3d + len(args).
 */
function initCodeHashERC1967(impl: Address, args: Hex): Hex {
  const implHex = impl.toLowerCase().replace(/^0x/, "");
  const argsHex = args.replace(/^0x/, "");
  const n = argsHex.length / 2;
  const runtimeLen = (0x3d + n).toString(16).padStart(4, "0");
  const creation =
    "0x61" +
    runtimeLen +
    "3d8160233d3973" +
    implHex +
    "6009" +
    "5155f3363d3d373d3d363d7f" +
    "360894a13ba1a3210667c828492db98dca3e2076" + // eip1967 impl slot (high 20 bytes)
    "cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3" + // slot tail + delegatecall suffix
    argsHex;
  return keccak256(creation as Hex);
}

/**
 * Deterministic deposit-wallet address for an owner EOA. Reproduces
 * `factory.predictWalletAddress(impl, bytes32(owner))` exactly (offline).
 */
export function deriveDepositWalletAddress(
  owner: Address,
  impl: Address = DEPOSIT_WALLET_IMPL,
): Address {
  const args = depositWalletArgs(owner);
  const salt = keccak256(args);
  return getCreate2Address({
    from: DEPOSIT_WALLET_FACTORY,
    salt,
    bytecodeHash: initCodeHashERC1967(impl, args),
  });
}

// --- EIP-712 domain separators (manual; no salt field) ----------------------

const EIP712_DOMAIN_TYPEHASH = keccak256(
  stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

/** Domain separator for a {name,version,chainId,verifyingContract} EIP-712 domain. */
export function domainSeparator(
  name: string,
  version: string,
  chainId: number | bigint,
  verifyingContract: Address,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(stringToHex(name)),
        keccak256(stringToHex(version)),
        BigInt(chainId),
        verifyingContract,
      ],
    ),
  );
}

/** CTF Exchange V2 domain separator (the order's "app" domain). */
export function exchangeV2DomainSeparator(chainId: SupportedChainId, exchange: Address): Hex {
  return domainSeparator("Polymarket CTF Exchange", "2", chainId, exchange);
}

// --- ERC-7739 nested signature (the type-3 wire scheme) ---------------------
//
// Solady ERC1271 (DepositWallet.isValidSignature) verifies an EXTERNAL caller's
// signature via the "TypedDataSign" nested-EIP-712 workflow. For an app `hash`
// of the form keccak256(0x1901 ‖ APP_DOMAIN_SEP ‖ contents), the EOA must sign:
//
//   keccak256(0x1901 ‖ APP_DOMAIN_SEP ‖ hashStruct(TypedDataSign{
//       contents, name, version, chainId, verifyingContract, salt }))
//
// i.e. an ordinary EIP-712 signature whose DOMAIN is the app (exchange/clob)
// domain and whose primary struct is `TypedDataSign`, carrying the WALLET's own
// domain fields as data. This is browser-signable via `signTypedData`.
//
// The on-chain `signature` (what we put on the order / in the auth header) is:
//   r ‖ s ‖ v ‖ APP_DOMAIN_SEP(32) ‖ contents(32) ‖ contentsType ‖ uint16(len)

/** Canonical EIP-712 type string for a struct with no nested refs (viem parity). */
function encodeStructType(name: string, fields: readonly { name: string; type: string }[]): string {
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

const ORDER_TYPE_STRING = encodeStructType("Order", CTF_EXCHANGE_V2_ORDER);
const CLOB_AUTH_TYPE_STRING = encodeStructType("ClobAuth", CLOB_AUTH_TYPE);

/** TypedDataSign field layout (contents first, then the wrapped domain fields). */
function typedDataSignFields(contentsName: string) {
  return [
    { name: "contents", type: contentsName },
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ] as const;
}

export interface Erc7739TypedData {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: "TypedDataSign";
  message: Record<string, unknown>;
}

/**
 * Build the EIP-712 `TypedDataSign` payload for the owner EOA to sign (browser
 * `signTypedData`). `appDomain` is the contract that will call `isValidSignature`
 * (the V2 exchange for orders; the ClobAuth domain for L1 auth). `contentsName`
 * + `contentsFields` describe the wrapped struct; `contents` is its value.
 */
export function buildErc7739TypedData(params: {
  appDomain: TypedDataDomain;
  walletAddress: Address;
  chainId: SupportedChainId;
  contentsName: string;
  contentsFields: readonly { name: string; type: string }[];
  contents: Record<string, unknown>;
}): Erc7739TypedData {
  const { appDomain, walletAddress, chainId, contentsName, contentsFields, contents } = params;
  return {
    domain: appDomain,
    types: {
      TypedDataSign: typedDataSignFields(contentsName),
      [contentsName]: contentsFields,
    },
    primaryType: "TypedDataSign",
    message: {
      contents,
      name: DEPOSIT_WALLET_DOMAIN_NAME,
      version: DEPOSIT_WALLET_DOMAIN_VERSION,
      chainId: BigInt(chainId),
      verifyingContract: walletAddress,
      salt: ZERO_BYTES32,
    },
  };
}

/**
 * Assemble the on-chain ERC-7739 `signature` from the EOA's 65-byte sig over the
 * TypedDataSign payload: `innerSig ‖ appDomainSep ‖ contents ‖ contentsType ‖ uint16(len)`.
 */
export function assembleErc7739Signature(params: {
  innerSignature: Hex;
  appDomainSeparator: Hex;
  contentsHash: Hex;
  contentsType: string;
}): Hex {
  const { innerSignature, appDomainSeparator, contentsHash, contentsType } = params;
  const typeHex = stringToHex(contentsType).slice(2);
  const len = (typeHex.length / 2) & 0xffff;
  const lenHex = len.toString(16).padStart(4, "0");
  return ("0x" +
    innerSignature.replace(/^0x/, "") +
    appDomainSeparator.replace(/^0x/, "") +
    contentsHash.replace(/^0x/, "") +
    typeHex +
    lenHex) as Hex;
}

// --- Order (sigType 3) convenience -----------------------------------------

/** keccak256 hashStruct of a V2 Order (the ERC-7739 `contents`). */
export function orderStructHash(order: OrderV2Value): Hex {
  return hashStruct({
    data: order as unknown as Record<string, unknown>,
    types: { Order: CTF_EXCHANGE_V2_ORDER as unknown as { name: string; type: string }[] },
    primaryType: "Order",
  });
}

/** TypedDataSign payload for a sigType-3 order (browser signs this). */
export function buildType3OrderTypedData(
  order: OrderV2Value,
  chainId: SupportedChainId,
  exchange: Address,
  walletAddress: Address,
): Erc7739TypedData {
  return buildErc7739TypedData({
    appDomain: { name: "Polymarket CTF Exchange", version: "2", chainId, verifyingContract: exchange },
    walletAddress,
    chainId,
    contentsName: "Order",
    contentsFields: CTF_EXCHANGE_V2_ORDER,
    contents: order as unknown as Record<string, unknown>,
  });
}

/** Assemble the order's on-chain `signature` field (sigType 3) from the inner sig. */
export function assembleType3OrderSignature(params: {
  order: OrderV2Value;
  innerSignature: Hex;
  chainId: SupportedChainId;
  exchange: Address;
}): Hex {
  return assembleErc7739Signature({
    innerSignature: params.innerSignature,
    appDomainSeparator: exchangeV2DomainSeparator(params.chainId, params.exchange),
    contentsHash: orderStructHash(params.order),
    contentsType: ORDER_TYPE_STRING,
  });
}

// --- L1 ClobAuth (sigType 3) convenience -----------------------------------

export interface ClobAuthValue {
  address: Address;
  timestamp: string;
  nonce: bigint;
  message: string;
}

/** keccak256 hashStruct of a ClobAuth message. */
export function clobAuthStructHash(auth: ClobAuthValue): Hex {
  return hashStruct({
    data: auth as unknown as Record<string, unknown>,
    types: { ClobAuth: CLOB_AUTH_TYPE as unknown as { name: string; type: string }[] },
    primaryType: "ClobAuth",
  });
}

/**
 * TypedDataSign payload for the L1 ClobAuth login of a deposit wallet (sigType 3).
 * `auth.address` MUST be the deposit wallet (NOT the EOA) — this is the fix for
 * Polymarket's own SDK bug where `order.signer != api_key.address` 400s.
 * ClobAuth's domain has NO verifyingContract.
 */
export function buildType3ClobAuthTypedData(
  auth: ClobAuthValue,
  chainId: SupportedChainId,
  walletAddress: Address,
): Erc7739TypedData {
  return buildErc7739TypedData({
    appDomain: { name: "ClobAuthDomain", version: "1", chainId },
    walletAddress,
    chainId,
    contentsName: "ClobAuth",
    contentsFields: CLOB_AUTH_TYPE,
    contents: auth as unknown as Record<string, unknown>,
  });
}

/** ClobAuth domain separator (no verifyingContract field). */
export function clobAuthDomainSeparator(chainId: SupportedChainId): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [
        keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId)")),
        keccak256(stringToHex("ClobAuthDomain")),
        keccak256(stringToHex("1")),
        BigInt(chainId),
      ],
    ),
  );
}

/** Assemble the ERC-1271 `signature` the CLOB validates for a type-3 L1 login. */
export function assembleType3ClobAuthSignature(params: {
  auth: ClobAuthValue;
  innerSignature: Hex;
  chainId: SupportedChainId;
}): Hex {
  return assembleErc7739Signature({
    innerSignature: params.innerSignature,
    appDomainSeparator: clobAuthDomainSeparator(params.chainId),
    contentsHash: clobAuthStructHash(params.auth),
    contentsType: CLOB_AUTH_TYPE_STRING,
  });
}

// --- Deposit-wallet batch execution (gasless approvals via relayer) ----------
//
// The deposit wallet's `execute(Batch, sig)` is `onlyFactory`, so setup actions
// (approvals, transfers out) run as a relayer-proxied `Batch`: the owner EOA
// signs an EIP-712 `Batch` (Solady WalletLib), the relayer submits it via
// `factory.proxy`. Because the relayer (factory) is a "safe caller", the wallet
// validates the batch via DIRECT ECDSA against owner() — so a plain
// `signTypedData(Batch)` 65-byte signature is all that's needed (NO ERC-7739
// wrapping for batches, unlike orders). Relayer wire format
// (`@polymarket/builder-relayer-client`): POST /submit `{type:"WALLET", from:EOA,
// to:factory, nonce, signature, depositWalletParams:{depositWallet, deadline, calls}}`;
// nonce from `GET /nonce?address=<EOA>&type=WALLET`.

/** One call in a deposit-wallet Batch (Solady WalletLib `Call`). */
export interface DepositWalletCall {
  target: Address;
  value: bigint;
  data: Hex;
}

/** Wire form of a Call for the relayer JSON (value as decimal string). */
export interface DepositWalletCallWire {
  target: Address;
  value: string;
  data: Hex;
}

const BATCH_TYPE = [
  { name: "wallet", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "calls", type: "Call[]" },
] as const;

const CALL_TYPE = [
  { name: "target", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
] as const;

const ERC20_APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const ERC1155_SET_APPROVAL_ABI = [
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
] as const;
const ERC20_TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/**
 * The four V2 trading approvals a deposit wallet must set (as Batch calls):
 * pUSD → exchangeV2 + negRiskExchangeV2 (MAX), and CTF `setApprovalForAll` for both.
 */
export function buildDepositWalletApprovalCalls(chainId: SupportedChainId): DepositWalletCall[] {
  const c = contractsForChain(chainId);
  const approve = (spender: Address): Hex =>
    encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, maxUint256] });
  const setApproval = (operator: Address): Hex =>
    encodeFunctionData({ abi: ERC1155_SET_APPROVAL_ABI, functionName: "setApprovalForAll", args: [operator, true] });
  return [
    { target: COLLATERAL_PUSD_V2, value: 0n, data: approve(c.exchangeV2) },
    { target: COLLATERAL_PUSD_V2, value: 0n, data: approve(c.negRiskExchangeV2) },
    { target: c.conditionalTokens, value: 0n, data: setApproval(c.exchangeV2) },
    { target: c.conditionalTokens, value: 0n, data: setApproval(c.negRiskExchangeV2) },
  ];
}

/** An ERC-20 `transfer(to, amount)` call (e.g. to sweep a deposit wallet's pUSD). */
export function buildErc20TransferCall(token: Address, to: Address, amount: bigint): DepositWalletCall {
  return {
    target: token,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [to, amount] }),
  };
}

/** Serialize Batch calls to the relayer's JSON wire form. */
export function depositWalletCallsToWire(calls: DepositWalletCall[]): DepositWalletCallWire[] {
  return calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data }));
}

/**
 * EIP-712 `Batch` typed data for the owner EOA to sign (browser `signTypedData`).
 * The relayer (factory, a safe caller) validates this via direct ECDSA against
 * owner(), so the resulting 65-byte signature is used as-is.
 */
export function buildDepositWalletBatchTypedData(params: {
  walletAddress: Address;
  chainId: SupportedChainId;
  nonce: bigint;
  deadline: bigint;
  calls: DepositWalletCall[];
}) {
  return {
    domain: {
      name: DEPOSIT_WALLET_DOMAIN_NAME,
      version: DEPOSIT_WALLET_DOMAIN_VERSION,
      chainId: params.chainId,
      verifyingContract: params.walletAddress,
    },
    types: {
      Batch: BATCH_TYPE as unknown as readonly { name: string; type: string }[],
      Call: CALL_TYPE as unknown as readonly { name: string; type: string }[],
    },
    primaryType: "Batch" as const,
    message: {
      wallet: params.walletAddress,
      nonce: params.nonce,
      deadline: params.deadline,
      calls: params.calls,
    },
  };
}
