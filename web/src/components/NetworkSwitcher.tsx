'use client';

import { useNetwork, type Network } from '@/contexts/NetworkContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Globe, Check, ChevronDown } from 'lucide-react';

export function NetworkSwitcher() {
  const { network, setNetwork } = useNetwork();

  const networks: { value: Network; label: string; disabled?: boolean }[] = [
    { value: 'devnet', label: 'Devnet' },
    { value: 'mainnet', label: 'Mainnet', disabled: true },
  ];

  const currentNetwork = networks.find((n) => n.value === network);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 cursor-pointer">
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline-block">{currentNetwork?.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Select Network</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {networks.map((net) => (
          <DropdownMenuItem
            key={net.value}
            onClick={() => !net.disabled && setNetwork(net.value)}
            disabled={net.disabled}
            className="cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span>{net.label}</span>
              {net.value === 'devnet' && (
                <Badge variant="secondary" className="text-xs">
                  Default
                </Badge>
              )}
            </div>
            {network === net.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

