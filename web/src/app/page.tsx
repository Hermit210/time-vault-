"use client";

import { useState, useEffect, type ReactNode, type ComponentType } from "react";
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

  return (
    <div className="relative">
      {/* Faint, restrained texture behind the hero */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-hairline-grid opacity-60" />

      {/* Hero */}
      <section className="mx-auto max-w-3xl pt-14 pb-12 text-center sm:pt-20">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-elev-1 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Non-custodial inheritance on Solana
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[3.25rem]">
          Pass on your crypto,
          <br className="hidden sm:block" /> exactly as you intend.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          TimeVault is an on-chain deadman switch. Set a check-in schedule — if you ever
          go quiet, your chosen beneficiary can claim your assets automatically, with no
          intermediary and no custody.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <WalletButton size="lg" label="Connect Wallet to Begin" className="shadow-elev-2" />
          <p className="text-xs text-muted-foreground">Devnet ready · Your keys, your assets</p>
        </div>
      </section>

      {/* Feature cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="transition-all duration-200 hover:border-border hover:shadow-elev-2">
            <CardContent className="pt-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand/15 bg-brand-muted/60 text-brand">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* How it works */}
      <section className="mt-6">
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-8 sm:grid-cols-3">
              {steps.map(({ n, title, body }, i) => (
                <div key={n} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-brand tabular-nums">{n}</span>
                    <span className="h-px flex-1 bg-border" />
                    {i < steps.length - 1 && (
                      <ArrowRight className="hidden h-4 w-4 text-muted-foreground/50 sm:block" />
                    )}
                  </div>
                  <h4 className="mt-3 text-sm font-semibold">{title}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Trust row */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
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
