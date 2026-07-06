import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { getProgram, findHandoverPDA } from "./program";

export interface InitializeVaultParams {
  owner: PublicKey;
  beneficiary: PublicKey;
  mint: PublicKey;
  tokenAccount: PublicKey;
  timeoutSeconds: number;
}

export async function constructInitializeVaultTransaction(
  connection: Connection,
  wallet: any,
  params: InitializeVaultParams
): Promise<Transaction> {
  const { owner, beneficiary, mint, tokenAccount, timeoutSeconds } = params;

  // Get program instance
  const program = getProgram(connection, wallet);

  // Find handover PDA
  const [handoverPDA] = findHandoverPDA(owner, mint, beneficiary);

  // Create the initialize instruction
  const initializeIx = await program.methods
    .initialize(new BN(timeoutSeconds))
    .accountsPartial({
      owner: owner,
      handover: handoverPDA,
      tokenAccount: tokenAccount,
      mint: mint,
      beneficiary: beneficiary,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  // Create transaction
  const transaction = new Transaction();
  transaction.add(initializeIx);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = owner;

  return transaction;
}

export interface VaultInfo {
  address: PublicKey;
  owner: PublicKey;
  beneficiary: PublicKey;
  tokenAccount: PublicKey;
  mint: PublicKey;
  lastCheckin: number;
  timeout: number;
  bump: number;
}

export async function getVaultInfo(
  connection: Connection,
  wallet: any,
  owner: PublicKey,
  mint: PublicKey,
  beneficiary: PublicKey
): Promise<VaultInfo | null> {
  try {
    const program = getProgram(connection, wallet);
    const [handoverPDA] = findHandoverPDA(owner, mint, beneficiary);

    const vaultAccount = await program.account.handover.fetch(handoverPDA);

    return {
      address: handoverPDA,
      owner: vaultAccount.owner,
      beneficiary: vaultAccount.beneficiary,
      tokenAccount: vaultAccount.tokenAccount,
      mint: vaultAccount.mint,
      lastCheckin: vaultAccount.lastCheckin.toNumber(),
      timeout: vaultAccount.timeout.toNumber(),
      bump: vaultAccount.bump,
    };
  } catch (error) {
    console.error("Error fetching vault info:", error);
    return null;
  }
}

export interface CheckinParams {
  owner: PublicKey;
  mint: PublicKey;
  beneficiary: PublicKey;
}

export async function constructCheckinTransaction(
  connection: Connection,
  wallet: any,
  params: CheckinParams
): Promise<Transaction> {
  const { owner, mint, beneficiary } = params;

  const program = getProgram(connection, wallet);
  const [handoverPDA] = findHandoverPDA(owner, mint, beneficiary);

  const checkinIx = await program.methods
    .checkin()
    .accountsPartial({
      owner: owner,
      handover: handoverPDA,
      mint: mint,
      beneficiary: beneficiary,
    })
    .instruction();

  const transaction = new Transaction();
  transaction.add(checkinIx);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = owner;

  return transaction;
}

export interface ClaimParams {
  beneficiary: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenAccount: PublicKey;
}

export async function constructClaimTransaction(
  connection: Connection,
  wallet: any,
  params: ClaimParams
): Promise<Transaction> {
  const { beneficiary, owner, mint, tokenAccount } = params;

  const program = getProgram(connection, wallet);
  const [handoverPDA] = findHandoverPDA(owner, mint, beneficiary);

  // Get associated token accounts
  const beneficiaryTokenAccount = getAssociatedTokenAddressSync(
    mint,
    beneficiary,
    false,
    TOKEN_PROGRAM_ID
  );

  const feeAuthority = new PublicKey("54o5R8Bxwceb5y9Q1nCb3p8eHyDnWDbCNvxptkbaSCi2");
  const feeTokenAccount = getAssociatedTokenAddressSync(
    mint,
    feeAuthority,
    false,
    TOKEN_PROGRAM_ID
  );

  const claimIx = await program.methods
    .claim()
    .accountsPartial({
      beneficiary: beneficiary,
      owner: owner,
      handover: handoverPDA,
      tokenAccount: tokenAccount,
      beneficiaryTokenAccount: beneficiaryTokenAccount,
      feeTokenAccount: feeTokenAccount,
      feeAuthority: feeAuthority,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = new Transaction();
  transaction.add(claimIx);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = beneficiary;

  return transaction;
}

export interface CancelParams {
  owner: PublicKey;
  mint: PublicKey;
  beneficiary: PublicKey;
  tokenAccount: PublicKey;
}

export async function constructCancelTransaction(
  connection: Connection,
  wallet: any,
  params: CancelParams
): Promise<Transaction> {
  const { owner, mint, beneficiary, tokenAccount } = params;

  const program = getProgram(connection, wallet);
  const [handoverPDA] = findHandoverPDA(owner, mint, beneficiary);

  const cancelIx = await program.methods
    .cancel()
    .accountsPartial({
      owner: owner,
      handover: handoverPDA,
      tokenAccount: tokenAccount,
      mint: mint,
      beneficiary: beneficiary,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = new Transaction();
  transaction.add(cancelIx);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = owner;

  return transaction;
}