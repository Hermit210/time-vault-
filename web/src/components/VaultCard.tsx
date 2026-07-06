"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Clock,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  X,
  Copy,
  Check,
  ArrowDownToLine,
} from "lucide-react";
import { constructCheckinTransaction, constructClaimTransaction, constructCancelTransaction } from "@/lib/vault";
import type { VaultData } from "@/lib/actions";
import { toastSuccess, toastError } from "@/lib/toast";
import { useNetwork } from "@/contexts/NetworkContext";
import { buildGatewayTransaction, sendGatewayTransaction } from "@/lib/gateway";

interface VaultCardProps {
  vault: VaultData;
  type: "owner" | "beneficiary";
  balance: number;
  onAction?: () => void;
}

interface TimeBreakdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function getTimeBreakdown(totalSeconds: number): TimeBreakdown {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds };
}

function formatAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// Tone system — refined semantic surfaces, driven by the same urgency logic.
type Tone = "safe" | "warning" | "danger" | "brand";

const toneStyles: Record<
  Tone,
  { pill: string; surface: string; icon: string; text: string; sub: string; bar: string }
> = {
  safe: {
    pill: "bg-success-surface text-success border-success-border",
    surface: "border-success-border/70 bg-success-surface/50",
    icon: "text-success",
    text: "text-success",
    sub: "text-success/80",
    bar: "bg-success",
  },
  warning: {
    pill: "bg-warning-surface text-warning border-warning-border",
    surface: "border-warning-border/70 bg-warning-surface/50",
    icon: "text-warning",
    text: "text-warning",
    sub: "text-warning/80",
    bar: "bg-warning",
  },
  danger: {
    pill: "bg-danger-surface text-danger border-danger-border",
    surface: "border-danger-border/70 bg-danger-surface/50",
    icon: "text-danger",
    text: "text-danger",
    sub: "text-danger/80",
    bar: "bg-danger",
  },
  brand: {
    pill: "bg-brand-muted text-brand border-transparent",
    surface: "border-brand/25 bg-brand-muted/50",
    icon: "text-brand",
    text: "text-brand",
    sub: "text-brand/80",
    bar: "bg-brand",
  },
};

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={handle}
      aria-label={`Copy ${label}`}
      className="group inline-flex items-center gap-1.5 rounded-md font-mono text-xs text-foreground/80 transition-colors hover:text-foreground cursor-pointer"
    >
      {formatAddress(value)}
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

export function VaultCard({ vault, type, balance, onAction }: VaultCardProps) {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { network } = useNetwork();
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    const calculateTimeRemaining = () => {
      const now = Math.floor(Date.now() / 1000);
      const deadline = vault.lastCheckin + vault.timeout;
      return deadline - now;
    };

    const updateTimer = () => {
      setTimeRemaining(calculateTimeRemaining());
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [vault.lastCheckin, vault.timeout]);

  const isExpired = timeRemaining <= 0;
  const canClaim = type === "beneficiary" && isExpired;

  // Calculate urgency based on percentage of time remaining
  const percentRemaining = (timeRemaining / vault.timeout) * 100;
  const getUrgency = (): "safe" | "warning" | "danger" => {
    if (isExpired) return "danger";
    if (percentRemaining <= 10) return "danger";
    if (percentRemaining <= 25) return "warning";
    return "safe";
  };
  const urgency = getUrgency();

  // Presentation tone: a claimable beneficiary vault reads as a positive call-to-action.
  const tone: Tone = canClaim ? "brand" : urgency;
  const t = toneStyles[tone];
  const barWidth = isExpired ? (canClaim ? 100 : 0) : Math.min(Math.max(percentRemaining, 2), 100);

  const statusLabel = canClaim
    ? "Claimable"
    : type === "owner"
      ? isExpired
        ? "Expired"
        : urgency === "danger"
          ? "Urgent"
          : urgency === "warning"
            ? "Action needed"
            : "Active"
      : isExpired
        ? "Expired"
        : "Locked";

  const headingLabel =
    type === "owner"
      ? isExpired
        ? "Check-in overdue by"
        : "Next check-in due in"
      : canClaim
        ? "Claimable now"
        : "Unlocks in";

  const captionLabel =
    type === "owner"
      ? isExpired
        ? "Your beneficiary can now claim this vault."
        : urgency === "danger"
          ? "Check in now to keep this vault active."
          : urgency === "warning"
            ? "Check in soon to stay active."
            : "All good — check in periodically to stay active."
      : canClaim
        ? "The owner has been inactive. You can claim now."
        : "Available to claim once the owner's deadline passes.";

  const handleCheckin = async () => {
    if (!publicKey || !wallet || !signTransaction) return;

    setIsLoading(true);
    try {
      const transaction = await constructCheckinTransaction(connection, wallet, {
        owner: new PublicKey(vault.owner),
        mint: new PublicKey(vault.mint),
        beneficiary: new PublicKey(vault.beneficiary),
      });

      const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      const { transaction: gatewayTxEncoded } = await buildGatewayTransaction(serializedTx, network);
      const gatewayTx = Transaction.from(Buffer.from(gatewayTxEncoded, "base64"));

      const signedTransaction = await signTransaction(gatewayTx);
      const serializedSignedTx = signedTransaction.serialize().toString("base64");
      const signature = await sendGatewayTransaction(serializedSignedTx, network);

      await connection.onSignature(signature, async (result) => {
        if (result.err) {
          console.error("Error:", result.err);
          toastError("Failed to check in", result.err);
          setIsLoading(false);
          return;
        }

        toastSuccess("Check-in successful!", signature, network);
        onAction?.();
        setIsLoading(false);
      }, "confirmed");

    } catch (error) {
      console.error("Error checking in:", error);
      toastError("Failed to check in", error);
      setIsLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!publicKey || !wallet || !signTransaction) return;

    setIsLoading(true);
    try {
      const transaction = await constructClaimTransaction(connection, wallet, {
        beneficiary: new PublicKey(vault.beneficiary),
        owner: new PublicKey(vault.owner),
        mint: new PublicKey(vault.mint),
        tokenAccount: new PublicKey(vault.tokenAccount),
      });

      const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      const { transaction: gatewayTxEncoded } = await buildGatewayTransaction(serializedTx, network);
      const gatewayTx = Transaction.from(Buffer.from(gatewayTxEncoded, "base64"));

      const signedTransaction = await signTransaction(gatewayTx);
      const serializedSignedTx = signedTransaction.serialize().toString("base64");
      const signature = await sendGatewayTransaction(serializedSignedTx, network);

      await connection.onSignature(signature, async (result) => {
        if (result.err) {
          console.error("Error:", result.err);
          toastError("Failed to claim vault", result.err);
          setIsLoading(false);
          return;
        }

        toastSuccess("Vault claimed successfully!", signature, network);
        onAction?.();
        setIsLoading(false);
      }, "confirmed");

    } catch (error) {
      console.error("Error claiming:", error);
      toastError("Failed to claim vault", error);
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!publicKey || !wallet || !signTransaction) return;

    setIsCancelling(true);
    try {
      const transaction = await constructCancelTransaction(connection, wallet, {
        owner: new PublicKey(vault.owner),
        mint: new PublicKey(vault.mint),
        beneficiary: new PublicKey(vault.beneficiary),
        tokenAccount: new PublicKey(vault.tokenAccount),
      });

      const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      const { transaction: gatewayTxEncoded } = await buildGatewayTransaction(serializedTx, network);
      const gatewayTx = Transaction.from(Buffer.from(gatewayTxEncoded, "base64"));

      const signedTransaction = await signTransaction(gatewayTx);
      const serializedSignedTx = signedTransaction.serialize().toString("base64");
      const signature = await sendGatewayTransaction(serializedSignedTx, network);

      await connection.onSignature(signature, async (result) => {
        if (result.err) {
          console.error("Error:", result.err);
          toastError("Failed to cancel vault", result.err);
          setIsCancelling(false);
          return;
        }

        toastSuccess("Vault cancelled successfully!", signature, network);
        onAction?.();
        setIsCancelling(false);
      }, "confirmed");

    } catch (error) {
      console.error("Error cancelling:", error);
      toastError("Failed to cancel vault", error);
      setIsCancelling(false);
    }
  };

  const { days, hours, minutes, seconds } = getTimeBreakdown(Math.abs(timeRemaining));
  const showDays = days > 0;
  const showHours = showDays || hours > 0;
  const showMinutes = showHours || minutes > 0;

  return (
    <Card className="overflow-hidden transition-all duration-200 hover:border-border hover:shadow-elev-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/15 bg-brand-muted/60">
              <ShieldCheck className="h-5 w-5 text-brand" strokeWidth={1.75} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold leading-tight tracking-tight">
                {type === "owner" ? "Your Vault" : "Inheritance Vault"}
              </h3>
              <CopyChip value={vault.publicKey} label="vault address" />
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${t.pill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${t.bar}`} />
            {statusLabel}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              {type === "owner" ? "Beneficiary" : "Owner"}
            </p>
            <CopyChip
              value={type === "owner" ? vault.beneficiary : vault.owner}
              label={type === "owner" ? "beneficiary address" : "owner address"}
            />
          </div>
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Token Mint
            </p>
            <CopyChip value={vault.mint} label="token mint" />
          </div>
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Balance
            </p>
            <p className="font-mono text-sm font-medium tabular-nums text-foreground">
              {balance.toFixed(2)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Timeout Period
            </p>
            <p className="text-sm font-medium tabular-nums text-foreground">
              {Math.floor(vault.timeout / 86400)}{" "}
              <span className="text-muted-foreground font-normal">days</span>
            </p>
          </div>
        </div>

        {/* Countdown */}
        <div className={`rounded-xl border p-4 ${t.surface}`}>
          <div className="flex items-center gap-2">
            {isExpired && type === "owner" ? (
              <AlertTriangle className={`h-4 w-4 ${t.icon}`} strokeWidth={2} />
            ) : canClaim ? (
              <ArrowDownToLine className={`h-4 w-4 ${t.icon}`} strokeWidth={2} />
            ) : (
              <Clock className={`h-4 w-4 ${t.icon}`} strokeWidth={2} />
            )}
            <p className={`text-sm font-medium ${t.text}`}>{headingLabel}</p>
          </div>

          {/* Time display */}
          <div className="mt-3 flex items-end gap-3">
            {showDays && <TimeUnit value={days} unit="d" color={t.text} />}
            {showHours && <TimeUnit value={hours} unit="h" color={t.text} />}
            {showMinutes && <TimeUnit value={minutes} unit="m" color={t.text} />}
            <TimeUnit value={seconds} unit="s" color={t.text} />
          </div>

          {/* Progress — proportion of the timeout window still remaining */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full ${t.bar} transition-[width] duration-500 ease-out`}
              style={{ width: `${barWidth}%` }}
            />
          </div>

          <p className={`mt-3 text-xs ${t.sub}`}>{captionLabel}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          {type === "owner" ? (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading || isCancelling}
                className="cursor-pointer"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling…
                  </>
                ) : (
                  <>
                    <X className="mr-2 h-4 w-4" />
                    Cancel Vault
                  </>
                )}
              </Button>
              <Button
                onClick={handleCheckin}
                disabled={isLoading || isCancelling}
                className="cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Check In
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button
              onClick={handleClaim}
              disabled={!canClaim || isLoading}
              className="cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <ArrowDownToLine className="mr-2 h-4 w-4" />
                  Claim Vault
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TimeUnit({ value, unit, color }: { value: number; unit: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`text-3xl font-semibold leading-none tabular-nums tracking-tight ${color}`}>
        {value.toString().padStart(2, "0")}
      </span>
      <span className={`text-sm font-medium ${color} opacity-70`}>{unit}</span>
    </div>
  );
}
