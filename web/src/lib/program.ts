import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import type { Timevault } from '../types/timevault';
import IDL from '../idl/timevault.json';

export const PROGRAM_ID = new PublicKey('Vau1tNwoYo91MsHHCMwn5Y1WzStFRzRxegH7CAX1vni');

export function getProgram(connection: Connection, wallet: any): Program<Timevault> {
  const provider = new AnchorProvider(
    connection,
    wallet,
    AnchorProvider.defaultOptions()
  );

  return new Program(IDL as Idl as Timevault, provider);
}

export function findHandoverPDA(
  owner: PublicKey,
  mint: PublicKey,
  beneficiary: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('handover'),
      owner.toBuffer(),
      mint.toBuffer(),
      beneficiary.toBuffer(),
    ],
    PROGRAM_ID
  );
}

