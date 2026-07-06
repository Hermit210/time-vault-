"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WalletButton, useWalletInfo } from "@/components/WalletButton";
import { NetworkSwitcher } from "@/components/NetworkSwitcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Clock, Heart, Shield, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
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
      <header className="border-b">
        <div className="container mx-auto max-w-7xl flex h-16 items-center px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Shield className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">Timevault</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NetworkSwitcher />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {connected ? (
          <div className="space-y-8">
            {/* Page Header */}
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Dashboard
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage your inheritance vaults and deadman switches
              </p>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    My Vaults
                  </CardTitle>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isLoadingVaults ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      ownerVaults.length
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">As owner</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Beneficiary Of
                  </CardTitle>
                  <Heart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isLoadingVaults ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      beneficiaryVaults.length
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Vaults you can inherit
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Next Check-in
                  </CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isLoadingVaults ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      formatNextCheckin()
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ownerVaults.length === 0 ? "No active vaults" : "Time until next check-in"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tabs Section */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList>
                <TabsTrigger value="owner">As Owner</TabsTrigger>
                <TabsTrigger value="beneficiary">As Beneficiary</TabsTrigger>
                <TabsTrigger value="create">Create New</TabsTrigger>
              </TabsList>

              <TabsContent value="owner" className="space-y-4">
                {isLoadingVaults ? (
                  <Card>
                    <CardContent className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </CardContent>
                  </Card>
                ) : ownerVaults.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Your Inheritance Vaults</h3>
                        <p className="text-sm text-muted-foreground">
                          Check in regularly to keep them active
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={reloadVaults}
                        disabled={isLoadingVaults}
                      >
                        Refresh
                      </Button>
                    </div>
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
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>Your Inheritance Vaults</CardTitle>
                      <CardDescription>
                        Vaults where you are the owner. Check in regularly to keep
                        them active.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="rounded-full bg-muted p-3 mb-4">
                          <Shield className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="font-semibold mb-1">No vaults yet</h3>
                        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                          Create your first inheritance vault to protect your
                          assets
                        </p>
                        <Button className="cursor-pointer" onClick={() => setActiveTab("create")}>Create Vault</Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="beneficiary" className="space-y-4">
                {isLoadingVaults ? (
                  <Card>
                    <CardContent className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </CardContent>
                  </Card>
                ) : beneficiaryVaults.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Vaults You Can Inherit</h3>
                        <p className="text-sm text-muted-foreground">
                          You can claim these if the owner becomes inactive
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={reloadVaults}
                        disabled={isLoadingVaults}
                      >
                        Refresh
                      </Button>
                    </div>
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
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>Vaults You Can Inherit</CardTitle>
                      <CardDescription>
                        Vaults where you are the beneficiary. You can claim these
                        if the owner becomes inactive.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="rounded-full bg-muted p-3 mb-4">
                          <Heart className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="font-semibold mb-1">No vaults assigned</h3>
                        <p className="text-sm text-muted-foreground max-w-sm">
                          You are not a beneficiary of any vaults yet
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="create" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Create Inheritance Vault</CardTitle>
                    <CardDescription>
                      Set up a deadman switch to automatically transfer assets
                      if you become inactive
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
                      <div className="flex gap-3">
                        <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                            How it works
                          </p>
                          <p className="text-sm text-blue-700 dark:text-blue-300">
                            You must check in periodically to prove you're
                            active. If you fail to check in before the timeout,
                            your beneficiary can claim the assets. A 0.5% fee
                            applies on claims.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Beneficiary Address
                        </label>
                        <input
                          type="text"
                          placeholder="Enter beneficiary's Solana address"
                          value={beneficiaryAddress}
                          onChange={(e) => setBeneficiaryAddress(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground">
                          The person who will inherit your assets
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Token Mint Address
                        </label>
                        <input
                          type="text"
                          placeholder="Enter SPL token mint address"
                          value={mintAddress}
                          onChange={(e) => setMintAddress(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground">
                          SPL token mint address for the vault
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Timeout Period
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Days</label>
                            <select
                              value={timeoutDays}
                              onChange={(e) => setTimeoutDays(e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {Array.from({ length: 366 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Hours</label>
                            <select
                              value={timeoutHours}
                              onChange={(e) => setTimeoutHours(e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Minutes</label>
                            <select
                              value={timeoutMinutes}
                              onChange={(e) => setTimeoutMinutes(e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {Array.from({ length: 60 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Seconds</label>
                            <select
                              value={timeoutSeconds}
                              onChange={(e) => setTimeoutSecondsInput(e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {Array.from({ length: 60 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Total: {timeoutSecondsTotal.toLocaleString()} seconds
                          {timeoutSecondsTotal >= 86400 && ` (${Math.floor(timeoutSecondsTotal / 86400)} days)`}
                        </p>
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
                            Initializing...
                          </>
                        ) : (
                          "Initialize Vault"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Wallet Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connected Wallet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    Connected
                  </Badge>
                  <code className="text-sm text-muted-foreground">
                    {shortAddress}
                  </code>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex min-h-[600px] items-center justify-center">
            <Card className="w-full max-w-lg">
              <CardHeader className="text-center space-y-4">
                <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <Shield className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-2xl mb-2">
                    Crypto Inheritance Made Simple
                  </CardTitle>
                  <CardDescription className="text-base">
                    Automated deadman switch for your digital assets on Solana
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Secure Inheritance</p>
                      <p className="text-xs text-muted-foreground">
                        Designate beneficiaries for your crypto assets
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Deadman Switch</p>
                      <p className="text-xs text-muted-foreground">
                        Assets transfer automatically if you become inactive
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Stay in Control</p>
                      <p className="text-xs text-muted-foreground">
                        Check in regularly to keep your vaults active
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-center">
                  <WalletButton />
                </div>
              </CardContent>
            </Card>
        </div>
        )}
      </main>
    </div>
  );
}
