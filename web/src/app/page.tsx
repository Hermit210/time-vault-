"use client";

import { useState, useEffect, type ReactNode, type ComponentType, type CSSProperties } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WalletButton, useWalletInfo } from "@/components/WalletButton";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Heart,
  ShieldCheck,
  Info,
  Loader2,
  RefreshCw,
  CheckCircle2,
  KeyRound,
  Users,
  Coins,
  Timer,
  Plus,
  ArrowRight,
  Lock,
  ChevronDown,
  Fingerprint,
} from "lucide-react";
import { constructInitializeVaultTransaction } from "@/lib/vault";
import { useNetwork } from "@/contexts/NetworkContext";
import { fetchVaultAccounts, getTokenBalance, type VaultData } from "@/lib/actions";
import { VaultCard } from "@/components/VaultCard";
import { toastSuccess, toastError } from "@/lib/toast";
import { buildGatewayTransaction, sendGatewayTransaction } from "@/lib/gateway";
// import { buildGatewayTransaction } from "@/lib/gateway";

export default function Home() {
  const { connected, shortAddress } = useWalletInfo();
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { network } = useNetwork();

  const [timeoutDays, setTimeoutDays] = useState<string>("30");
  const [timeoutHours, setTimeoutHours] = useState<string>("0");
  const [timeoutMinutes, setTimeoutMinutes] = useState<string>("0");
  const [timeoutSeconds, setTimeoutSecondsInput] = useState<string>("0");
  const [beneficiaryAddress, setBeneficiaryAddress] = useState<string>("");
  const [mintAddress, setMintAddress] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("owner");

  const [ownerVaults, setOwnerVaults] = useState<VaultData[]>([]);
  const [beneficiaryVaults, setBeneficiaryVaults] = useState<VaultData[]>([]);
  const [vaultBalances, setVaultBalances] = useState<Record<string, number>>({});
  const [isLoadingVaults, setIsLoadingVaults] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Convert days/hours/minutes/seconds to total seconds for the Solana program
  const timeoutSecondsTotal =
    (Number(timeoutDays) || 0) * 86400 +
    (Number(timeoutHours) || 0) * 3600 +
    (Number(timeoutMinutes) || 0) * 60 +
    (Number(timeoutSeconds) || 0);

  // Fetch vaults when wallet connects or network changes
  useEffect(() => {
    const loadVaults = async () => {
      if (!publicKey) {
        setOwnerVaults([]);
        setBeneficiaryVaults([]);
        setVaultBalances({});
        return;
      }

      setIsLoadingVaults(true);
      try {
        const { ownerVaults: owned, beneficiaryVaults: beneficiary } =
          await fetchVaultAccounts(publicKey.toString(), network);

        setOwnerVaults(owned);
        setBeneficiaryVaults(beneficiary);

        // Fetch balances for all vaults
        const balances: Record<string, number> = {};
        const allVaults = [...owned, ...beneficiary];

        await Promise.all(
          allVaults.map(async (vault) => {
            try {
              const balance = await getTokenBalance(vault.tokenAccount, network);
              balances[vault.publicKey] = balance;
            } catch (error) {
              console.error(`Error fetching balance for ${vault.publicKey}:`, error);
              balances[vault.publicKey] = 0;
            }
          })
        );

        setVaultBalances(balances);
      } catch (error) {
        console.error("Error loading vaults:", error);
      } finally {
        setIsLoadingVaults(false);
      }
    };

    loadVaults();
  }, [publicKey, network]);

  const reloadVaults = async () => {
    if (!publicKey) return;

    setIsLoadingVaults(true);
    try {
      const { ownerVaults: owned, beneficiaryVaults: beneficiary } =
        await fetchVaultAccounts(publicKey.toString(), network);

      setOwnerVaults(owned);
      setBeneficiaryVaults(beneficiary);

      // Fetch balances for all vaults
      const balances: Record<string, number> = {};
      const allVaults = [...owned, ...beneficiary];

      await Promise.all(
        allVaults.map(async (vault) => {
          try {
            const balance = await getTokenBalance(vault.tokenAccount, network);
            balances[vault.publicKey] = balance;
          } catch (error) {
            console.error(`Error fetching balance for ${vault.publicKey}:`, error);
            balances[vault.publicKey] = 0;
          }
        })
      );

      setVaultBalances(balances);
    } catch (error) {
      console.error("Error reloading vaults:", error);
    } finally {
      setIsLoadingVaults(false);
    }
  };

  // Calculate next check-in time for owner vaults
  const getNextCheckin = () => {
    if (ownerVaults.length === 0) return null;

    const now = Math.floor(Date.now() / 1000);
    let closestDeadline = Infinity;

    for (const vault of ownerVaults) {
      const deadline = vault.lastCheckin + vault.timeout;
      const timeUntil = deadline - now;
      if (timeUntil > 0 && timeUntil < closestDeadline) {
        closestDeadline = timeUntil;
      }
    }

    return closestDeadline === Infinity ? null : closestDeadline;
  };

  const formatNextCheckin = () => {
    const seconds = getNextCheckin();
    if (!seconds) return "--";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const handleReset = () => {
    setBeneficiaryAddress("");
    setMintAddress("");
    setTimeoutDays("30");
    setTimeoutHours("0");
    setTimeoutMinutes("0");
    setTimeoutSecondsInput("0");
  };

  const handleInitializeVault = async () => {
    if (!publicKey || !wallet || !beneficiaryAddress || !mintAddress || !signTransaction) return;

    setIsInitializing(true);
    try {
      const beneficiaryPubkey = new PublicKey(beneficiaryAddress);
      const mintPubkey = new PublicKey(mintAddress);
      const tokenAccount = getAssociatedTokenAddressSync(
        mintPubkey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      const transaction = await constructInitializeVaultTransaction(
        connection,
        wallet,
        {
          owner: publicKey,
          beneficiary: beneficiaryPubkey,
          mint: mintPubkey,
          tokenAccount: tokenAccount,
          timeoutSeconds: timeoutSecondsTotal,
        }
      );

      const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      const { transaction: gatewayTxEncoded } = await buildGatewayTransaction(serializedTx, network);
      const gatewayTx = Transaction.from(Buffer.from(gatewayTxEncoded, "base64"));

      const signedTransaction = await signTransaction(gatewayTx);
      const serializedSignedTx = signedTransaction.serialize().toString("base64");
      const signature = await sendGatewayTransaction(serializedSignedTx, network);

      await connection.onSignature(signature, async (result) => {
        if (result.err) {
          console.error("Error:", result.err);
          toastError("Failed to initialize vault", result.err);
          setIsInitializing(false);
          return;
        }

        toastSuccess("Vault initialized successfully!", signature, network);
        handleReset();
        await reloadVaults();
        setActiveTab("owner");
        setIsInitializing(false);
      }, "confirmed");

    } catch (err) {
      console.error("Error:", err);
      toastError("Failed to initialize vault", err);
      setIsInitializing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto max-w-6xl flex h-16 items-center gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-elev-1">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[0.95rem] font-semibold tracking-tight">TimeVault</span>
              <span className="mt-0.5 text-[0.62rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Inheritance Protocol
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NetworkSwitcher />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        {connected ? (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Page Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[2rem] font-semibold leading-none tracking-tight">
                  Dashboard
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Manage your inheritance vaults and deadman switches.
                </p>
              </div>
              <Button
                className="cursor-pointer"
                onClick={() => setActiveTab("create")}
              >
                <Plus className="h-4 w-4" />
                New Vault
              </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  label: "My Vaults",
                  icon: ShieldCheck,
                  value: ownerVaults.length,
                  sub: "Vaults you own",
                },
                {
                  label: "Beneficiary Of",
                  icon: Heart,
                  value: beneficiaryVaults.length,
                  sub: "Vaults you can inherit",
                },
                {
                  label: "Next Check-in",
                  icon: Clock,
                  value: formatNextCheckin(),
                  sub: ownerVaults.length === 0 ? "No active vaults" : "Until next check-in",
                },
              ].map(({ label, icon: Icon, value, sub }) => (
                <Card key={label} className="gap-0 py-5">
                  <CardHeader className="pb-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {label}
                      </p>
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="text-3xl font-semibold tracking-tight tabular-nums">
                      {isLoadingVaults ? (
                        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                      ) : (
                        value
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tabs Section */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="sm:w-auto">
                <TabsTrigger value="owner">
                  As Owner
                  {!isLoadingVaults && ownerVaults.length > 0 && (
                    <span className="ml-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums">
                      {ownerVaults.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="beneficiary">
                  As Beneficiary
                  {!isLoadingVaults && beneficiaryVaults.length > 0 && (
                    <span className="ml-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums">
                      {beneficiaryVaults.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="create">
                  <Plus className="h-4 w-4" />
                  Create
                </TabsTrigger>
              </TabsList>

              <TabsContent value="owner" className="space-y-5">
                {isLoadingVaults ? (
                  <VaultsLoading />
                ) : ownerVaults.length > 0 ? (
                  <div className="space-y-5">
                    <SectionHeader
                      title="Your Inheritance Vaults"
                      description="Check in regularly to keep them active."
                      onRefresh={reloadVaults}
                      disabled={isLoadingVaults}
                    />
                    <div className="grid gap-5 xl:grid-cols-2">
                      {ownerVaults.map((vault) => (
                        <VaultCard
                          key={vault.publicKey}
                          vault={vault}
                          type="owner"
                          balance={vaultBalances[vault.publicKey] || 0}
                          onAction={reloadVaults}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={ShieldCheck}
                    title="No vaults yet"
                    description="Create your first inheritance vault to protect your assets and designate a beneficiary."
                    action={
                      <Button className="cursor-pointer" onClick={() => setActiveTab("create")}>
                        <Plus className="h-4 w-4" />
                        Create Vault
                      </Button>
                    }
                  />
                )}
              </TabsContent>

              <TabsContent value="beneficiary" className="space-y-5">
                {isLoadingVaults ? (
                  <VaultsLoading />
                ) : beneficiaryVaults.length > 0 ? (
                  <div className="space-y-5">
                    <SectionHeader
                      title="Vaults You Can Inherit"
                      description="You can claim these once the owner becomes inactive."
                      onRefresh={reloadVaults}
                      disabled={isLoadingVaults}
                    />
                    <div className="grid gap-5 xl:grid-cols-2">
                      {beneficiaryVaults.map((vault) => (
                        <VaultCard
                          key={vault.publicKey}
                          vault={vault}
                          type="beneficiary"
                          balance={vaultBalances[vault.publicKey] || 0}
                          onAction={reloadVaults}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={Heart}
                    title="No vaults assigned"
                    description="You are not a beneficiary of any vaults yet. When someone names you, they will appear here."
                  />
                )}
              </TabsContent>

              <TabsContent value="create" className="space-y-4">
                <Card className="mx-auto max-w-2xl">
                  <CardHeader className="border-b [.border-b]:pb-6">
                    <CardTitle className="text-xl tracking-tight">Create Inheritance Vault</CardTitle>
                    <CardDescription className="text-[0.9rem]">
                      Set up a deadman switch to automatically transfer assets if you become inactive.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-7 pt-6">
                    <div className="flex gap-3 rounded-xl border bg-muted/40 p-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted">
                        <Info className="h-4 w-4 text-brand" strokeWidth={2} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">How it works</p>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          You must check in periodically to prove you&rsquo;re active. If you fail to
                          check in before the timeout, your beneficiary can claim the assets.
                          A 0.5% fee applies on claims.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="space-y-2">
                        <label htmlFor="beneficiary" className="flex items-center gap-1.5 text-sm font-medium">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          Beneficiary Address
                        </label>
                        <input
                          id="beneficiary"
                          type="text"
                          placeholder="Enter beneficiary's Solana address"
                          value={beneficiaryAddress}
                          onChange={(e) => setBeneficiaryAddress(e.target.value)}
                          className="h-11 w-full rounded-lg border border-input bg-card px-3.5 font-mono text-sm shadow-elev-1 outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-muted-foreground/70 focus-visible:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                        />
                        <p className="text-xs text-muted-foreground">
                          The person who will inherit your assets.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="mint" className="flex items-center gap-1.5 text-sm font-medium">
                          <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                          Token Mint Address
                        </label>
                        <input
                          id="mint"
                          type="text"
                          placeholder="Enter SPL token mint address"
                          value={mintAddress}
                          onChange={(e) => setMintAddress(e.target.value)}
                          className="h-11 w-full rounded-lg border border-input bg-card px-3.5 font-mono text-sm shadow-elev-1 outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-muted-foreground/70 focus-visible:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                        />
                        <p className="text-xs text-muted-foreground">
                          SPL token mint address for the vault.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-1.5 text-sm font-medium">
                          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                          Timeout Period
                        </label>
                        <div className="grid grid-cols-4 gap-2.5">
                          {[
                            { label: "Days", value: timeoutDays, set: setTimeoutDays, len: 366 },
                            { label: "Hours", value: timeoutHours, set: setTimeoutHours, len: 24 },
                            { label: "Minutes", value: timeoutMinutes, set: setTimeoutMinutes, len: 60 },
                            { label: "Seconds", value: timeoutSeconds, set: setTimeoutSecondsInput, len: 60 },
                          ].map(({ label, value, set, len }) => (
                            <div key={label} className="space-y-1.5">
                              <label className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
                                {label}
                              </label>
                              <select
                                aria-label={label}
                                value={value}
                                onChange={(e) => set(e.target.value)}
                                className="h-11 w-full cursor-pointer rounded-lg border border-input bg-card px-3 text-sm tabular-nums shadow-elev-1 outline-none transition-[border-color,box-shadow] focus-visible:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                              >
                                {Array.from({ length: len }, (_, i) => (
                                  <option key={i} value={i}>
                                    {i}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="tabular-nums">
                            Total: {timeoutSecondsTotal.toLocaleString()} seconds
                            {timeoutSecondsTotal >= 86400 && ` · ${Math.floor(timeoutSecondsTotal / 86400)} days`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        className="cursor-pointer"
                        onClick={handleReset}
                        disabled={isInitializing}
                      >
                        Reset
                      </Button>
                      <Button
                        className="cursor-pointer"
                        onClick={handleInitializeVault}
                        disabled={!connected || isInitializing}
                      >
                        {isInitializing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Initializing…
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Initialize Vault
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Wallet Info Card */}
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                  </span>
                  <span className="text-sm font-medium">Wallet connected</span>
                </div>
                <code className="rounded-lg bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
                  {shortAddress}
                </code>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Landing />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/70">
        <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>TimeVault · Non-custodial inheritance on Solana</span>
          </div>
          <span>Your keys, your assets. Always.</span>
        </div>
      </footer>
    </div>
  );
}

/* ————————————————————————————————————————————————
   Presentational helpers — layout only, no business logic
   ———————————————————————————————————————————————— */

function SectionHeader({
  title,
  description,
  onRefresh,
  disabled,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={disabled} className="cursor-pointer">
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

function VaultsLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {[0, 1].map((i) => (
        <Card key={i} className="h-64 animate-pulse">
          <CardContent className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border bg-muted/50 text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
        {action && <div className="mt-6">{action}</div>}
      </CardContent>
    </Card>
  );
}

function Landing() {
  const features = [
    {
      icon: ShieldCheck,
      title: "Secure inheritance",
      body: "Designate a beneficiary for any SPL token. Ownership only ever moves on your terms.",
    },
    {
      icon: Timer,
      title: "Deadman switch",
      body: "Choose a timeout. Miss your check-in window and only your beneficiary can claim — no one else.",
    },
    {
      icon: KeyRound,
      title: "Always in control",
      body: "Check in anytime to reset the clock, or cancel the vault and reclaim your assets instantly.",
    },
  ];

  const steps = [
    { n: "01", title: "Create a vault", body: "Set your beneficiary, the token, and a check-in timeout." },
    { n: "02", title: "Check in regularly", body: "Every check-in resets the countdown and proves you're active." },
    { n: "03", title: "Automatic handover", body: "If the timer runs out, your beneficiary can claim — trustlessly." },
  ];

  const security = [
    {
      icon: Lock,
      title: "Non-custodial by design",
      body: "Assets rest in a program-derived vault. No company, admin, or third party can ever touch them.",
    },
    {
      icon: ShieldCheck,
      title: "On-chain enforcement",
      body: "Timeouts, check-ins, and claims are enforced by the Solana program — not a server that can go down.",
    },
    {
      icon: Fingerprint,
      title: "You hold the keys",
      body: "Only your wallet can check in or cancel. Only your beneficiary can claim, and only after the deadline.",
    },
  ];

  const faqs = [
    {
      q: "Is TimeVault really non-custodial?",
      a: "Yes. Your tokens sit in an on-chain vault governed entirely by the program's rules. Only you can check in or cancel, and only your named beneficiary can claim once the timeout passes.",
    },
    {
      q: "What happens if I miss a check-in?",
      a: "Nothing moves until the timeout elapses. Once it does, your beneficiary is able to claim the vault's balance. Right up until that moment, a single check-in resets the clock.",
    },
    {
      q: "Are there any fees?",
      a: "A 0.5% fee applies on a successful claim. Creating a vault, checking in, and cancelling only cost standard Solana network fees.",
    },
    {
      q: "Which tokens can I protect?",
      a: "Any SPL token. When you create a vault you simply provide the token's mint address along with your beneficiary.",
    },
    {
      q: "Can I change my mind later?",
      a: "Absolutely. As the owner you can cancel a vault at any time and reclaim your assets instantly.",
    },
  ];

  return (
    <div className="relative">
      {/* Ambient crypto × time backdrop */}
      <HeroBackdrop />

      {/* Hero */}
      <section className="mx-auto max-w-3xl pt-14 pb-10 text-center sm:pt-20">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-elev-1 backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
          </span>
          Non-custodial inheritance on Solana
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[3.25rem] animate-in fade-in slide-in-from-bottom-3 duration-700">
          Pass on your crypto,
          <br className="hidden sm:block" /> exactly as you intend.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          TimeVault is an on-chain deadman switch. Set a check-in schedule — if you ever
          go quiet, your chosen beneficiary can claim your assets automatically, with no
          intermediary and no custody.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <WalletButton size="lg" label="Connect Wallet to Begin" className="shadow-elev-2" />
          <a
            href="#how-it-works"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-input bg-card/60 px-5 text-[0.95rem] font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            See how it works
            <ChevronDown className="h-4 w-4" />
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Devnet ready · Your keys, your assets</p>
      </section>

      {/* Feature cards */}
      <section className="mt-24">
        <SectionEyebrow label="Why TimeVault" />
        <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Protection that works even when you can&rsquo;t.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="group transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-elev-2">
              <CardContent className="pt-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand/15 bg-brand-muted/60 text-brand transition-transform duration-200 group-hover:scale-105">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mt-24 scroll-mt-24">
        <SectionEyebrow label="How it works" />
        <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Three steps to a trustless handover.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map(({ n, title, body }, i) => (
            <Card key={n} className="relative">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted/70 font-mono text-sm font-semibold tabular-nums text-brand">
                    {n}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  {i < steps.length - 1 && (
                    <ArrowRight className="hidden h-4 w-4 text-muted-foreground/40 sm:block" />
                  )}
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Security */}
      <section className="mt-24">
        <SectionEyebrow label="Security" />
        <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Built to be trusted with what matters.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {security.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4 rounded-2xl border bg-card/40 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/15 bg-brand-muted/60 text-brand">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mt-24">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionEyebrow label="FAQ" />
            <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Questions, answered.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Everything you need to know before you create your first vault. Still curious?
              Connect your wallet and try it on Devnet.
            </p>
          </div>
          <Card>
            <CardContent className="px-5 py-1 sm:px-6">
              {faqs.map((f) => (
                <FaqItem key={f.q} q={f.q} a={f.a} />
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mt-24">
        <Card className="relative overflow-hidden border-brand/20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(70% 120% at 50% 0%, color-mix(in oklch, var(--brand) 16%, transparent), transparent 70%)",
            }}
          />
          <CardContent className="relative flex flex-col items-center gap-5 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-elev-1">
              <ShieldCheck className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h2 className="max-w-xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Secure your legacy in minutes.
            </h2>
            <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
              Set up your first inheritance vault today. It stays fully in your control —
              until the moment it needs not to be.
            </p>
            <WalletButton size="lg" label="Connect Wallet to Begin" className="mt-1 shadow-elev-2" />
          </CardContent>
        </Card>
      </section>

      {/* Trust row */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
        {["Non-custodial by design", "On-chain enforcement", "You stay in control"].map((t) => (
          <div key={t} className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2} />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

// Decorative ambient backdrop — clock/dial (time) + orbiting nodes (crypto).
// Purely visual: aria-hidden, non-interactive, honours reduced-motion.
function HeroBackdrop() {
  const spin = (dur: number, reverse = false): CSSProperties => ({
    transformBox: "view-box",
    transformOrigin: "400px 400px",
    animation: `tv-rotate ${dur}s linear infinite${reverse ? " reverse" : ""}`,
    willChange: "transform",
  });

  const nodes: { r: number; dur: number; reverse?: boolean; dot: number; line: number }[] = [
    { r: 300, dur: 44, dot: 4.5, line: 0.1 },
    { r: 232, dur: 60, reverse: true, dot: 3.5, line: 0.08 },
    { r: 300, dur: 52, reverse: true, dot: 3, line: 0.07 },
    { r: 166, dur: 34, dot: 3, line: 0.09 },
  ];

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] overflow-hidden"
    >
      {/* Hairline grid + soft maroon glow */}
      <div className="absolute inset-0 bg-hairline-grid opacity-40" />
      <div
        className="absolute left-1/2 top-[-8%] h-[460px] w-[900px] max-w-[98vw] -translate-x-1/2 rounded-[50%] opacity-70 blur-[2px]"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, color-mix(in oklch, var(--brand) 24%, transparent), transparent 72%)",
        }}
      />

      {/* Chronosphere: concentric dial + orbiting nodes + sweep */}
      <div className="absolute left-1/2 top-[-190px] aspect-square w-[1120px] max-w-none -translate-x-1/2 opacity-[0.55] [mask-image:radial-gradient(closest-side,#000_54%,transparent_100%)] [-webkit-mask-image:radial-gradient(closest-side,#000_54%,transparent_100%)]">
        <svg viewBox="0 0 800 800" className="h-full w-full text-brand">
          <defs>
            <radialGradient id="tvSweep" cx="400" cy="400" r="340" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.20" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
            <filter id="tvGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Base rings */}
          <circle cx="400" cy="400" r="360" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          <circle cx="400" cy="400" r="250" fill="none" stroke="currentColor" strokeOpacity="0.09" />
          <circle cx="400" cy="400" r="180" fill="none" stroke="currentColor" strokeOpacity="0.10" />
          <circle cx="400" cy="400" r="110" fill="none" stroke="currentColor" strokeOpacity="0.08" />

          {/* Minute ticks (60) — slowly drifting like time */}
          <circle
            cx="400"
            cy="400"
            r="340"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="8"
            strokeDasharray="2 33.6"
            style={spin(240)}
          />
          {/* Hour ticks (12) — counter-rotating */}
          <circle
            cx="400"
            cy="400"
            r="300"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.30"
            strokeWidth="12"
            strokeDasharray="3 154"
            style={spin(360, true)}
          />

          {/* Radar sweep + hand */}
          <g style={spin(9)}>
            <path d="M400,400 L400,60 A340,340 0 0 1 570,106 Z" fill="url(#tvSweep)" />
            <line x1="400" y1="400" x2="400" y2="64" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.5" />
            <circle cx="400" cy="64" r="3.5" fill="currentColor" filter="url(#tvGlow)" />
          </g>

          {/* Orbiting network nodes with connecting lines */}
          {nodes.map((n, i) => (
            <g key={i} style={spin(n.dur, n.reverse)}>
              <line
                x1="400"
                y1="400"
                x2="400"
                y2={400 - n.r}
                stroke="currentColor"
                strokeOpacity={n.line}
                strokeWidth="1"
              />
              <circle
                cx="400"
                cy={400 - n.r}
                r={n.dot}
                fill="currentColor"
                filter="url(#tvGlow)"
                style={{ animation: `tv-pulse-soft ${5 + i}s ease-in-out infinite` }}
              />
            </g>
          ))}

          {/* Core */}
          <circle cx="400" cy="400" r="4" fill="currentColor" filter="url(#tvGlow)" opacity="0.7" />
        </svg>
      </div>
    </div>
  );
}

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{label}</span>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-medium sm:text-[0.95rem]">{q}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] pb-4" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <p className="text-sm leading-relaxed text-muted-foreground">{a}</p>
        </div>
      </div>
    </div>
  );
}
