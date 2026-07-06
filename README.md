# TimeVault
An automated inheritance plan for your Solana tokens.

## WHAT IS THIS? 

Lock your tokens with a beneficiary. If you don't check in within your timeout period, they can claim them. Think of it like a digital inheritance plan.


## How it works
-> Set it up - Lock your tokens with a beneficiary and timeout (e.g., 30 days)

-> Stay active - Check in before the timeout expires to keep control

-> Handover - If you don't check in, your beneficiary can claim the tokens (with a 0.5% protocol fee)


> Lock in a beneficiary for your tokens and a check-in schedule. As long as you
> check in, nothing changes. If you ever go quiet past your timeout, your
> beneficiary — and only your beneficiary — can claim the assets. No custody, no
> intermediary, no admin key.

- **Program ID:** `Vau1tNwoYo91MsHHCMwn5Y1WzStFRzRxegH7CAX1vni`
- **Network:** Solana Devnet (live) · Mainnet (planned)
- **License / status:** Experimental, unaudited — see [Disclaimer](#13-disclaimer)

---

# TimeVault Whitepaper

### Abstract

Self-custody is the defining promise of crypto and also its cruelest failure
mode. When a holder loses access to their keys — through death, incapacity, lost
seed phrases, or simple neglect — the assets are gone forever. There is no
support line, no probate court that can move an on-chain balance, no
"forgot password." Billions of dollars of digital assets are already
permanently frozen for exactly this reason.

**TimeVault** is a minimal, non-custodial *deadman switch* built as a Solana
program. An owner designates a beneficiary and a timeout period. The owner
proves liveness by periodically "checking in." If the owner fails to check in
before the deadline, the beneficiary becomes able to claim the tokens directly
on-chain. The protocol never takes custody of funds, has no privileged
administrator, and enforces every rule in program code that anyone can verify.

This document describes the problem, the design, the on-chain architecture, the
security model, the application stack, and the roadmap.

---

## Table of Contents

1. [Introduction & Motivation](#1-introduction--motivation)
2. [Solution Overview](#2-solution-overview)
3. [Design Principles](#3-design-principles)
4. [Protocol Lifecycle](#4-protocol-lifecycle)
5. [On-Chain Architecture](#5-on-chain-architecture)
6. [Instruction Reference](#6-instruction-reference)
7. [Fee Model](#7-fee-model)
8. [Security Model & Threat Analysis](#8-security-model--threat-analysis)
9. [Application Architecture](#9-application-architecture)
10. [Use Cases](#10-use-cases)
11. [Roadmap & Future Work](#11-roadmap--future-work)
12. [Getting Started](#12-getting-started)
13. [Disclaimer](#13-disclaimer)
14. [FAQ](#14-faq)
15. [Glossary](#15-glossary)

---

## 1. Introduction & Motivation

Traditional finance has centuries of infrastructure for handing assets to the
next generation: wills, executors, probate, beneficiary designations, joint
accounts. None of it works on a public blockchain, because on-chain assets are
controlled by cryptographic keys, not legal identity. A court order cannot sign
a Solana transaction.

This creates a widening gap:

- **Key loss is permanent and silent.** If a holder dies or loses their seed
  phrase, there is no recovery path. The tokens simply sit, unspendable, forever.
- **Sharing keys defeats self-custody.** Handing your seed phrase to a relative
  "just in case" gives them full control *today*, not only when it's needed.
- **Custodial "inheritance" reintroduces the very risk crypto removes.** Trusting
  a company to hold and later release your assets means trusting them not to
  fail, freeze, or disappear.

What's needed is a way to arrange a *conditional, future* transfer of control —
one that costs the owner nothing today, keeps them in full control, and only
activates when they can no longer act. That is precisely the deadman-switch
pattern, and TimeVault implements it natively on Solana.

---

## 2. Solution Overview

TimeVault is built around a single on-chain account — the **Handover** — that
records an agreement:

> *"If `owner` has not checked in for `timeout` seconds, then `beneficiary` may
> claim the tokens in `token_account`."*

The mechanism relies on the SPL Token **delegate/approval** model rather than
moving funds into an escrow. When a vault is created, the owner *approves* the
Handover account (a Program-Derived Address) as a delegate over their token
account. Crucially:

- The tokens **never leave the owner's own wallet.** The owner retains full
  custody and can spend, transfer, or manage them at any time.
- The delegation grants the program the *ability* to move tokens — but the
  program will only ever exercise it under one condition: a valid claim after
  the deadline has passed.
- The owner can **revoke** the arrangement at any moment by cancelling the vault.

There are exactly four operations: **initialize**, **check-in**, **claim**, and
**cancel**. Everything the protocol does is one of these four, and each is fully
enforced by program logic.

---

## 3. Design Principles

1. **Non-custodial, always.** Funds stay in the owner's token account. The
   protocol holds nothing and cannot spend anything except a legitimate claim.
2. **No admin, no upgrade backdoor to your funds.** There is no privileged role
   that can move user tokens, pause claims, or seize assets. Rules live in code.
3. **Trustless enforcement.** Timeouts, check-ins, and claim eligibility are
   evaluated by the on-chain program against the Solana cluster clock — not by a
   server that could be switched off.
4. **Minimal surface area.** Four instructions and one account type. Less code is
   less risk. Nothing is added that the core promise doesn't require.
5. **Owner sovereignty.** The owner can reset the clock or exit entirely at any
   time, right up until the moment the deadline passes.
6. **Verifiable.** The program is open and its addresses are published; anyone
   can inspect exactly what the code does before trusting it.

---

## 4. Protocol Lifecycle

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   initialize ─────▶│   ACTIVE  (last_checkin + timeout in future)│◀──┐
   (owner)          │                                             │   │ checkin
                    └───────────────────┬─────────────────────────┘   │ (owner, resets clock)
                                        │                             │
                          timeout elapses without check-in            │
                                        │                             │
                                        ▼                             │
                    ┌─────────────────────────────────────────────┐  │
                    │   EXPIRED  (now > last_checkin + timeout)    │──┘
                    └───────────────────┬─────────────────────────┘
                                        │
                     claim (beneficiary)│      cancel (owner, any time)
                                        ▼               │
                    ┌──────────────────────┐            ▼
                    │  Tokens → beneficiary │   ┌──────────────────────┐
                    │  0.5% fee → protocol  │   │ Delegation revoked;   │
                    │  Handover closed      │   │ Handover closed;      │
                    └──────────────────────┘   │ rent returned to owner │
                                               └──────────────────────┘
```

**1. Set it up (initialize).** The owner picks a beneficiary, an SPL token, and a
timeout (e.g. 30 days). A Handover account is created, the current time is
recorded as `last_checkin`, and the Handover PDA is approved as a delegate over
the owner's token account.

**2. Stay active (check-in).** Before the deadline (`last_checkin + timeout`), the
owner sends a check-in, which resets `last_checkin` to "now." As long as the
owner keeps checking in, the beneficiary can never claim.

**3. Handover (claim).** If the current time passes the deadline, the beneficiary
can claim. The program transfers the token account's balance to the
beneficiary, minus a 0.5% protocol fee, and closes the Handover.

**4. Exit anytime (cancel).** The owner can cancel at any point, which revokes the
delegation and closes the Handover, returning the account's rent.

---

## 5. On-Chain Architecture

The protocol is a single [Anchor](https://www.anchor-lang.com/) program written
in Rust.

### 5.1 The `Handover` account

One `Handover` account represents one vault. It is a Program-Derived Address
(PDA), deterministically derived from the parties and the token, so a given
`(owner, mint, beneficiary)` triple maps to exactly one vault.

| Field           | Type     | Meaning                                                    |
| --------------- | -------- | ---------------------------------------------------------- |
| `owner`         | `Pubkey` | The vault creator; the only account that can check in/cancel. |
| `beneficiary`   | `Pubkey` | The account allowed to claim after expiry.                 |
| `token_account` | `Pubkey` | The owner's SPL token account the vault governs.           |
| `mint`          | `Pubkey` | The SPL token mint.                                         |
| `last_checkin`  | `i64`    | Unix timestamp of the most recent check-in (or creation).  |
| `timeout`       | `i64`    | Seconds of allowed inactivity before claim is possible.    |
| `bump`          | `u8`     | PDA bump seed.                                              |

Account size: `8 (discriminator) + 32×4 + 8×2 + 1 = 153 bytes`.

### 5.2 PDA derivation

```
seeds = [ "handover", owner_pubkey, mint_pubkey, beneficiary_pubkey ]
```

Because the beneficiary and mint are part of the seeds, a single owner can run
many independent vaults — one per token, per beneficiary.

### 5.3 The delegation (non-custody) model

Instead of escrowing tokens, `initialize` issues an SPL `approve` that names the
Handover PDA as a delegate with an allowance of `u64::MAX` over the owner's token
account. Consequences of this design:

- The owner **keeps custody** and can move or spend the tokens freely.
- On a valid claim, the PDA signs (via its seeds) an SPL `transfer` moving the
  balance out — this is the only time the delegation is used.
- **The claimable amount is whatever is in the token account at claim time.** If
  the owner has spent the balance down, the beneficiary receives that lower
  amount. TimeVault promises *conditional transfer of what's there*, not a locked
  escrow.
- `cancel` issues an SPL `revoke`, immediately ending the delegation.

---

## 6. Instruction Reference

### `initialize(timeout: i64)`

Creates a vault. Records `last_checkin = now`, stores the parties/token, and
approves the Handover PDA as delegate.

- **Signer:** `owner`
- **Requires:** `timeout > 0` (`InvalidTimeout` otherwise); the token account
  must be owned by `owner` and match `mint`.
- **Creates:** the `Handover` PDA (rent paid by owner).

### `checkin()`

Resets the liveness clock.

- **Signer:** `owner` (enforced by `has_one = owner`)
- **Effect:** `last_checkin = now`. This is the owner's proof of life.

### `claim()`

Transfers the tokens to the beneficiary after expiry.

- **Signer:** `beneficiary` (enforced by `has_one = beneficiary`)
- **Requires:** `now > last_checkin + timeout` (`StillActive` otherwise).
- **Effect:** computes `fee = amount × 5 / 1000` (0.5%), sends the fee to the
  protocol fee account and the remainder to the beneficiary's associated token
  account (created if needed), then zeroes and closes the Handover (rent to
  beneficiary). Overflow-checked arithmetic throughout (`ArithmeticError`).

### `cancel()`

Owner exits the arrangement.

- **Signer:** `owner` (enforced by `has_one = owner`)
- **Effect:** revokes the SPL delegation, zeroes and closes the Handover, and
  returns its rent to the owner.

### Error codes

| Code               | Meaning                                             |
| ------------------ | --------------------------------------------------- |
| `StillActive`      | Claim attempted before the deadline passed.         |
| `InvalidTokenAccount` | Provided token account doesn't match the vault.  |
| `InvalidMint`      | Mint mismatch.                                       |
| `ArithmeticError`  | Overflow/underflow in timeout or fee math.          |
| `InvalidTimeout`   | `timeout` was not greater than zero.                |

---

## 7. Fee Model

TimeVault charges a single, transparent fee:

- **0.5% on successful claims only.** Computed as `amount × 5 / 1000` and routed
  to the protocol fee account.
- **No other fees.** Creating a vault, checking in, and cancelling incur only the
  standard Solana network transaction cost. There are no subscriptions, no
  deposit fees, and no fee on cancellation.

**Protocol fee account:** `54o5R8Bxwceb5y9Q1nCb3p8eHyDnWDbCNvxptkbaSCi2`

The fee aligns cost with value: you pay only at the moment the protocol actually
performs its core job — a successful, trustless handover.

---

## 8. Security Model & Threat Analysis

**What the program guarantees**

- Only the `owner` can check in or cancel (signature + `has_one` constraints).
- Only the named `beneficiary` can claim, and only after `now > deadline`.
- Claims and fee math use checked arithmetic; the vault account is zeroed before
  being closed.
- The PDA can move tokens *only* via a claim that satisfies the deadline
  condition — there is no instruction that lets anyone drain funds otherwise.

**Threats considered**

| Threat                                   | Mitigation                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Beneficiary claims early                 | `require!(now > last_checkin + timeout)` — rejected as `StillActive`.   |
| Attacker impersonates owner/beneficiary  | Signer checks + `has_one` constraints bind the parties to the PDA.      |
| Wrong token account substituted in claim | `address = handover.token_account` constraint enforces the exact one.   |
| Fee redirected                           | Fee authority is pinned to a constant address in the program.           |
| Admin seizure                            | There is no admin instruction; no role can move user funds.             |

**Honest caveats (please read)**

- **Delegation ≠ escrow.** Tokens are not locked. If the owner spends the balance,
  less (or nothing) is available to claim. Fund the token account with what you
  intend to hand over, and keep it funded.
- **Liveness is your responsibility.** Miss your check-in window and the
  beneficiary *can* claim. Choose a timeout with comfortable margin. (A future
  version will add reminders — see the roadmap.)
- **Clock granularity.** Deadlines use the Solana cluster's `unix_timestamp`,
  which is approximate to a few seconds — fine for day/week timeouts.
- **Not audited.** This is experimental software running on Devnet. Do not secure
  material value with it yet.

---

## 9. Application Architecture

The repository includes a reference web application (`/web`) that provides a
polished interface to the program.

**Stack**

- **Framework:** Next.js 15 (App Router) + React 19
- **Styling:** Tailwind CSS v4, with a custom, theme-aware design system
  (light/dark) and refined semantic states
- **Wallets:** Solana Wallet Adapter — Phantom, Solflare, Torus, Ledger
- **Program client:** `@coral-xyz/anchor` + `@solana/web3.js` / `@solana/spl-token`
- **Transaction relay:** Transactions are built and submitted through the Sanctum
  Trusted Payments Gateway (`tpg.sanctum.so`)
- **RPC / data:** Helius RPC for reading vault accounts and token balances
- **Networks:** Devnet (default, live); Mainnet is present in the UI but disabled
  pending audit

**What the app does**

- Discovers vaults where the connected wallet is the owner or the beneficiary
- Shows live countdowns with urgency states (active / action needed / urgent /
  expired) and each vault's balance
- Drives all four instructions (create, check-in, claim, cancel) end to end
- Surfaces transaction results with links to Solana Explorer

The web app is purely a client of the on-chain program; it holds no keys and
custodies nothing.

---

## 10. Use Cases

- **Personal crypto inheritance.** Ensure a spouse, child, or trusted person can
  recover your tokens if something happens to you.
- **Key-loss insurance.** A safety net for your own future self — a backup wallet
  can be the beneficiary if you ever lose access to your primary.
- **Team / treasury continuity.** A designated successor can recover a
  project's tokens if the key holder becomes unavailable.
- **Long-term / cold holdings.** Pair a long timeout with rare check-ins for
  assets you rarely touch but want to remain recoverable.

---

## 11. Roadmap & Future Work

Directional, not a commitment:

- **Mainnet launch** following a third-party security audit.
- **Check-in reminders** via email/push/wallet notifications ahead of deadlines.
- **Multiple beneficiaries** and split allocations per vault.
- **Escrow mode** (optional token locking) alongside today's delegate model.
- **Grace periods & staged handovers** for softer transitions.
- **Vault analytics** and richer portfolio views.

---

## 12. Getting Started

### Prerequisites

- Rust, the Solana CLI, and [Anchor](https://www.anchor-lang.com/)
- Node.js 18+ and Yarn (program tests) / a package manager of choice (web app)

### Build & test the program

```bash
yarn install
anchor build
anchor test
```

### Run the web app

```bash
cd web
# copy env template and add your keys
cp .env.example .env.local   # set HELIUS_API_KEY and GATEWAY_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

> The interface renders without keys, but live reads (vault/balances) and
> transaction relaying require `HELIUS_API_KEY` and `GATEWAY_API_KEY`.

### Program usage (TypeScript)

**Initialize**
```typescript
await program.methods
  .initialize(new BN(30 * 24 * 60 * 60)) // 30 days, in seconds
  .accounts({ owner, tokenAccount, mint, beneficiary })
  .signers([owner])
  .rpc();
```

**Check in**
```typescript
await program.methods
  .checkin()
  .accountsPartial({ owner, mint, beneficiary })
  .signers([owner])
  .rpc();
```

**Claim (beneficiary)**
```typescript
await program.methods
  .claim()
  .accountsPartial({ mint, owner, tokenAccount, beneficiary })
  .signers([beneficiary])
  .rpc();
```

**Cancel (owner)**
```typescript
await program.methods
  .cancel()
  .accountsPartial({ owner, mint, tokenAccount, beneficiary })
  .signers([owner])
  .rpc();
```

### Addresses

| Item                | Address                                          |
| ------------------- | ------------------------------------------------ |
| Program ID          | `Vau1tNwoYo91MsHHCMwn5Y1WzStFRzRxegH7CAX1vni`     |
| Protocol fee account| `54o5R8Bxwceb5y9Q1nCb3p8eHyDnWDbCNvxptkbaSCi2`    |

---

## 13. Disclaimer

TimeVault is **experimental, unaudited software** provided **as-is**, with no
warranty of any kind. It currently runs on Solana **Devnet** for demonstration
and testing. Nothing here is financial, legal, or estate-planning advice.
On-chain arrangements may not be recognized by, or interact with, the laws of
your jurisdiction. Do not use TimeVault to secure assets you cannot afford to
lose, and always verify addresses and behavior yourself before trusting any
smart contract. You are solely responsible for your keys, your check-ins, and
your funds.

---

## 14. FAQ

**Is TimeVault really non-custodial?**
Yes. Your tokens remain in your own token account. The program is only *approved*
as a delegate and will only ever move funds through a valid claim after your
timeout has passed. Until then — and forever, if you keep checking in — nothing
moves.

**What happens if I miss a check-in?**
Nothing moves until the timeout elapses. Once it does, your beneficiary is able
to claim. Right up to that moment, a single check-in resets the clock.

**Are there fees?**
A 0.5% fee applies to a successful claim. Creating, checking in, and cancelling
cost only standard Solana network fees.

**Which tokens are supported?**
Any SPL token — you provide its mint address when creating a vault.

**Can I cancel or change my mind?**
Yes. As the owner you can cancel at any time; this revokes the delegation and
closes the vault instantly.

**Can I have more than one vault?**
Yes. Vaults are keyed by `(owner, mint, beneficiary)`, so you can run many in
parallel across different tokens and beneficiaries.

**Which network is this on?**
Solana Devnet today. Mainnet is planned after an audit.

---

## 15. Glossary

- **Deadman switch** — a mechanism that triggers automatically when a person
  fails to perform a periodic action (here, checking in).
- **Handover** — TimeVault's on-chain account representing a single vault/agreement.
- **PDA (Program-Derived Address)** — a deterministic, program-owned address with
  no private key; used here as the vault account and delegate authority.
- **Delegate / approval** — an SPL Token feature letting an account authorize
  another to transfer up to an allowance, without giving up ownership.
- **Timeout** — the seconds of allowed inactivity before a claim becomes possible.
- **Check-in** — the owner's periodic proof-of-liveness that resets the timeout.
- **Claim** — the beneficiary's post-expiry action that transfers the tokens.
- **Beneficiary** — the party who may claim the assets after expiry.
