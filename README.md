# Timevault

An automated inheritance plan for your Solana tokens.

## What is this?

Lock your tokens with a beneficiary. If you don't check in within your timeout period, they can claim them. Think of it like a digital inheritance plan.

## How it works

1. **Set it up** - Lock your tokens with a beneficiary and timeout (e.g., 30 days)
2. **Stay active** - Check in before the timeout expires to keep control
3. **Handover** - If you don't check in, your beneficiary can claim the tokens (with a 0.5% protocol fee)

## Quick Start

```bash
yarn install
anchor build
anchor test
```

## Usage

**Initialize**
```typescript
await program.methods
  .initialize(new BN(30 * 24 * 60 * 60)) // 30 days
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

## Program ID

`Vau1tNwoYo91MsHHCMwn5Y1WzStFRzRxegH7CAX1vni`
