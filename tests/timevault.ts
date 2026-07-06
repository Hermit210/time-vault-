import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Timevault } from "../target/types/timevault";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

describe("timevault", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.timevault as Program<Timevault>;

  let mint: PublicKey;
  let ownerTokenAccount: PublicKey;
  let owner: Keypair;
  let beneficiary: Keypair;
  let handoverPda: PublicKey;
  let handoverBump: number;

  const TIMEOUT = 20; // 20 seconds timeout for testing
  const INITIAL_MINT_AMOUNT = 1_000_000_000; // 1 billion tokens (with 6 decimals = 1000 tokens)

  before(async () => {
    // Create keypairs for owner and beneficiary
    owner = Keypair.generate();
    beneficiary = Keypair.generate();

    // Airdrop SOL to owner and beneficiary
    const ownerAirdrop = await provider.connection.requestAirdrop(
      owner.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(ownerAirdrop);

    const beneficiaryAirdrop = await provider.connection.requestAirdrop(
      beneficiary.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(beneficiaryAirdrop);

    // Create mint
    mint = await createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      6 // 6 decimals
    );

    // Create token account for owner
    ownerTokenAccount = await createAccount(
      provider.connection,
      owner,
      mint,
      owner.publicKey
    );

    // Mint tokens to owner's account
    await mintTo(
      provider.connection,
      owner,
      mint,
      ownerTokenAccount,
      owner.publicKey,
      INITIAL_MINT_AMOUNT
    );

    // Derive handover PDA
    [handoverPda, handoverBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("handover"),
        owner.publicKey.toBuffer(),
        mint.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    console.log("Setup complete:");
    console.log("Owner:", owner.publicKey.toString());
    console.log("Beneficiary:", beneficiary.publicKey.toString());
    console.log("Mint:", mint.toString());
    console.log("Handover PDA:", handoverPda.toString());
  });

  it("Initialize - creates a handover with valid parameters", async () => {
    const tx = await program.methods
      .initialize(new BN(TIMEOUT))
      .accounts({
        owner: owner.publicKey,
        tokenAccount: ownerTokenAccount,
        mint: mint,
        beneficiary: beneficiary.publicKey,
      })
      .signers([owner])
      .rpc();

    console.log("Initialize transaction signature:", tx);

    // Fetch and verify the handover account
    const handoverAccount = await program.account.handover.fetch(handoverPda);

    assert.equal(
      handoverAccount.owner.toString(),
      owner.publicKey.toString(),
      "Owner should match"
    );
    assert.equal(
      handoverAccount.beneficiary.toString(),
      beneficiary.publicKey.toString(),
      "Beneficiary should match"
    );
    assert.equal(
      handoverAccount.tokenAccount.toString(),
      ownerTokenAccount.toString(),
      "Token account should match"
    );
    assert.equal(
      handoverAccount.mint.toString(),
      mint.toString(),
      "Mint should match"
    );
    assert.equal(
      handoverAccount.timeout.toNumber(),
      TIMEOUT,
      "Timeout should match"
    );
    assert.equal(handoverAccount.bump, handoverBump, "Bump should match");
    assert.isAbove(
      handoverAccount.lastCheckin.toNumber(),
      0,
      "Last checkin should be set"
    );

    // Verify delegation was set
    const tokenAccountInfo = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    assert.equal(
      tokenAccountInfo.delegate?.toString(),
      handoverPda.toString(),
      "Handover PDA should be delegate"
    );
    assert.equal(
      tokenAccountInfo.delegatedAmount.toString(),
      "18446744073709551615", // u64::MAX
      "Delegated amount should be u64::MAX"
    );
  });

  it("Checkin - owner can update last checkin time", async () => {
    // Get initial checkin time
    const handoverBefore = await program.account.handover.fetch(handoverPda);
    const initialCheckin = handoverBefore.lastCheckin;

    // Wait a moment to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Perform checkin
    const tx = await program.methods
      .checkin()
      .accountsPartial({
        owner: owner.publicKey,
        mint: mint,
        beneficiary: beneficiary.publicKey,
      })
      .signers([owner])
      .rpc();

    console.log("Checkin transaction signature:", tx);

    // Verify checkin time was updated
    const handoverAfter = await program.account.handover.fetch(handoverPda);
    assert.isAbove(
      handoverAfter.lastCheckin.toNumber(),
      initialCheckin.toNumber(),
      "Last checkin should be updated"
    );
  });

  it("Checkin - fails when non-owner tries to checkin", async () => {
    try {
      await program.methods
        .checkin()
        .accountsPartial({
          owner: owner.publicKey,
          mint: mint,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();

      assert.fail("Should have failed when non-owner tries to checkin");
    } catch (error) {
      // Expected to fail due to constraint violation
      assert.isTrue(error.toString().includes("Error"));
    }
  });

  it("Cancel - fails when non-owner tries to cancel", async () => {
    try {
      await program.methods
        .cancel()
        .accountsPartial({
          owner: owner.publicKey,
          tokenAccount: ownerTokenAccount,
          mint: mint,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();

      assert.fail("Should have failed when non-owner tries to cancel");
    } catch (error) {
      // Expected to fail due to constraint violation
      assert.isTrue(error.toString().includes("Error"));
    }
  });

  it("Cancel - successfully cancels vault and revokes delegation", async () => {
    // Verify delegation exists before cancel
    const tokenAccountBefore = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    assert.equal(
      tokenAccountBefore.delegate?.toString(),
      handoverPda.toString(),
      "Handover PDA should be delegate before cancel"
    );
    assert.equal(
      tokenAccountBefore.delegatedAmount.toString(),
      "18446744073709551615", // u64::MAX
      "Delegated amount should be u64::MAX before cancel"
    );

    // Get owner's SOL balance before (to verify rent is returned)
    const ownerBalanceBefore = await provider.connection.getBalance(
      owner.publicKey
    );

    // Cancel the vault
    const tx = await program.methods
      .cancel()
      .accountsPartial({
        owner: owner.publicKey,
        tokenAccount: ownerTokenAccount,
        mint: mint,
        beneficiary: beneficiary.publicKey,
      })
      .signers([owner])
      .rpc();

    console.log("Cancel transaction signature:", tx);

    // Verify delegation was revoked
    const tokenAccountAfter = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    assert.isNull(
      tokenAccountAfter.delegate,
      "Delegate should be null after cancel"
    );
    assert.equal(
      tokenAccountAfter.delegatedAmount.toString(),
      "0",
      "Delegated amount should be 0 after cancel"
    );

    // Verify handover account is closed
    try {
      await program.account.handover.fetch(handoverPda);
      assert.fail("Handover account should be closed after cancel");
    } catch (error) {
      assert.include(
        error.toString(),
        "Account does not exist",
        "Handover account should be closed"
      );
    }

    // Verify owner received rent back (balance should increase)
    const ownerBalanceAfter = await provider.connection.getBalance(
      owner.publicKey
    );
    assert.isAbove(
      ownerBalanceAfter,
      ownerBalanceBefore,
      "Owner should receive rent back"
    );

    console.log(
      `Rent returned to owner: ${
        (ownerBalanceAfter - ownerBalanceBefore) / anchor.web3.LAMPORTS_PER_SOL
      } SOL`
    );
  });

  // Re-initialize for remaining tests
  it("Re-initialize - creates a new handover for claim tests", async () => {
    const tx = await program.methods
      .initialize(new BN(TIMEOUT))
      .accounts({
        owner: owner.publicKey,
        tokenAccount: ownerTokenAccount,
        mint: mint,
        beneficiary: beneficiary.publicKey,
      })
      .signers([owner])
      .rpc();

    console.log("Re-initialize transaction signature:", tx);

    // Fetch and verify the handover account
    const handoverAccount = await program.account.handover.fetch(handoverPda);
    assert.equal(
      handoverAccount.owner.toString(),
      owner.publicKey.toString(),
      "Owner should match after re-initialization"
    );

    // Verify delegation was re-set
    const tokenAccountInfo = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    assert.equal(
      tokenAccountInfo.delegate?.toString(),
      handoverPda.toString(),
      "Handover PDA should be delegate after re-initialization"
    );
  });

  it("Claim - fails when timeout hasn't expired", async () => {
    try {
      await program.methods
        .claim()
        .accountsPartial({
          mint,
          owner: owner.publicKey,
          tokenAccount: ownerTokenAccount,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();

      assert.fail("Should have failed when timeout hasn't expired");
    } catch (error) {
      assert.include(error.toString(), "StillActive");
    }
  });

  it("Claim - successfully transfers tokens after timeout expires", async () => {
    // Wait for timeout to expire (with a small buffer)
    console.log(`Waiting ${TIMEOUT + 2} seconds for timeout to expire...`);
    await new Promise((resolve) => setTimeout(resolve, (TIMEOUT + 2) * 1000));

    const FEE_ACCOUNT = new PublicKey(
      "54o5R8Bxwceb5y9Q1nCb3p8eHyDnWDbCNvxptkbaSCi2"
    );

    const [beneficiaryTokenAccount] = PublicKey.findProgramAddressSync(
      [
        beneficiary.publicKey.toBuffer(),
        anchor.utils.token.TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      anchor.utils.token.ASSOCIATED_PROGRAM_ID
    );

    const [feeTokenAccount] = PublicKey.findProgramAddressSync(
      [
        FEE_ACCOUNT.toBuffer(),
        anchor.utils.token.TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      anchor.utils.token.ASSOCIATED_PROGRAM_ID
    );

    // Get initial token balance
    const ownerAccountBefore = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    const initialBalance = ownerAccountBefore.amount;

    // Claim tokens
    const tx = await program.methods
      .claim()
      .accountsPartial({
        mint,
        owner: owner.publicKey,
        tokenAccount: ownerTokenAccount,
        beneficiary: beneficiary.publicKey,
      })
      .signers([beneficiary])
      .rpc();

    console.log("Claim transaction signature:", tx);

    // Verify token transfers
    const beneficiaryAccount = await getAccount(
      provider.connection,
      beneficiaryTokenAccount
    );
    const feeAccount = await getAccount(provider.connection, feeTokenAccount);

    // Calculate expected amounts (0.5% fee)
    const feeAmount = (initialBalance * BigInt(5)) / BigInt(1000);
    const beneficiaryAmount = initialBalance - feeAmount;

    assert.equal(
      beneficiaryAccount.amount.toString(),
      beneficiaryAmount.toString(),
      "Beneficiary should receive correct amount"
    );
    assert.equal(
      feeAccount.amount.toString(),
      feeAmount.toString(),
      "Fee account should receive 0.5%"
    );

    // Verify handover account is closed
    try {
      await program.account.handover.fetch(handoverPda);
      assert.fail("Handover account should be closed");
    } catch (error) {
      assert.include(
        error.toString(),
        "Account does not exist",
        "Handover account should be closed"
      );
    }

    console.log("Test complete!");
    console.log(`Initial balance: ${initialBalance}`);
    console.log(`Fee (0.5%): ${feeAmount}`);
    console.log(`Beneficiary received: ${beneficiaryAmount}`);
  });
});
