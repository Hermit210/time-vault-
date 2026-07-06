"use server";

import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from './program';

export interface VaultData {
  publicKey: string;
  owner: string;
  beneficiary: string;
  tokenAccount: string;
  mint: string;
  lastCheckin: number;
  timeout: number;
  bump: number;
}

function getHeliusEndpoint(network: 'devnet' | 'mainnet'): string {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error('HELIUS_API_KEY is not set');
  }

  const cluster = network === 'mainnet' ? 'mainnet-beta' : 'devnet';
  return `https://${cluster}.helius-rpc.com/?api-key=${apiKey}`;
}

function deserializeHandoverAccount(data: Buffer): VaultData | null {
  try {
    // Skip discriminator (8 bytes)
    let offset = 8;

    // Read owner (32 bytes)
    const owner = new PublicKey(data.slice(offset, offset + 32)).toString();
    offset += 32;

    // Read beneficiary (32 bytes)
    const beneficiary = new PublicKey(data.slice(offset, offset + 32)).toString();
    offset += 32;

    // Read token_account (32 bytes)
    const tokenAccount = new PublicKey(data.slice(offset, offset + 32)).toString();
    offset += 32;

    // Read mint (32 bytes)
    const mint = new PublicKey(data.slice(offset, offset + 32)).toString();
    offset += 32;

    // Read last_checkin (8 bytes, i64)
    const lastCheckin = data.readBigInt64LE(offset);
    offset += 8;

    // Read timeout (8 bytes, i64)
    const timeout = data.readBigInt64LE(offset);
    offset += 8;

    // Read bump (1 byte)
    const bump = data.readUInt8(offset);

    return {
      publicKey: '', // Will be set by caller
      owner,
      beneficiary,
      tokenAccount,
      mint,
      lastCheckin: Number(lastCheckin),
      timeout: Number(timeout),
      bump,
    };
  } catch (error) {
    console.error('Error deserializing handover account:', error);
    return null;
  }
}

export async function fetchVaultAccounts(
  userAddress: string,
  network: 'devnet' | 'mainnet' = 'devnet'
): Promise<{ ownerVaults: VaultData[]; beneficiaryVaults: VaultData[] }> {
  try {
    const endpoint = getHeliusEndpoint(network);
    const connection = new Connection(endpoint, 'confirmed');
    const userPubkey = new PublicKey(userAddress);

    // Account structure (from state.rs):
    // 8 bytes: discriminator
    // 32 bytes: owner (offset 8)
    // 32 bytes: beneficiary (offset 40)
    // 32 bytes: token_account (offset 72)
    // 32 bytes: mint (offset 104)
    // 8 bytes: last_checkin (offset 136)
    // 8 bytes: timeout (offset 144)
    // 1 byte: bump (offset 152)
    // Total: 153 bytes

    // Fetch vaults where user is the owner
    const ownerAccountsPromise = connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        {
          dataSize: 153,
        },
        {
          memcmp: {
            offset: 8, // owner field offset
            bytes: userPubkey.toBase58(),
          },
        },
      ],
    });

    // Fetch vaults where user is the beneficiary
    const beneficiaryAccountsPromise = connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        {
          dataSize: 153,
        },
        {
          memcmp: {
            offset: 40, // beneficiary field offset
            bytes: userPubkey.toBase58(),
          },
        },
      ],
    });

    // Fetch both in parallel
    const [ownerAccounts, beneficiaryAccounts] = await Promise.all([
      ownerAccountsPromise,
      beneficiaryAccountsPromise,
    ]);

    const ownerVaults: VaultData[] = [];
    const beneficiaryVaults: VaultData[] = [];

    // Process owner vaults
    for (const { pubkey, account } of ownerAccounts) {
      const vaultData = deserializeHandoverAccount(account.data);
      if (!vaultData) continue;
      vaultData.publicKey = pubkey.toString();
      ownerVaults.push(vaultData);
    }

    // Process beneficiary vaults
    for (const { pubkey, account } of beneficiaryAccounts) {
      const vaultData = deserializeHandoverAccount(account.data);
      if (!vaultData) continue;
      vaultData.publicKey = pubkey.toString();
      beneficiaryVaults.push(vaultData);
    }

    return { ownerVaults, beneficiaryVaults };
  } catch (error) {
    console.error('Error fetching vault accounts:', error);
    return { ownerVaults: [], beneficiaryVaults: [] };
  }
}

export async function getTokenBalance(
  tokenAccountAddress: string,
  network: 'devnet' | 'mainnet' = 'devnet'
): Promise<number> {
  try {
    const endpoint = getHeliusEndpoint(network);
    const connection = new Connection(endpoint, 'confirmed');
    const tokenAccount = new PublicKey(tokenAccountAddress);

    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return Number(balance.value.amount) / Math.pow(10, balance.value.decimals);
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0;
  }
}

