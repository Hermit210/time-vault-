'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type Network = 'devnet' | 'mainnet';

interface NetworkContextType {
  network: Network;
  setNetwork: (network: Network) => void;
  endpoint: string;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>('devnet');

  const getEndpoint = (net: Network): string => {
    switch (net) {
      case 'devnet':
        return 'https://api.devnet.solana.com';
      case 'mainnet':
        return 'https://api.mainnet-beta.solana.com';
      default:
        return 'https://api.devnet.solana.com';
    }
  };

  const endpoint = getEndpoint(network);

  return (
    <NetworkContext.Provider value={{ network, setNetwork, endpoint }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}

