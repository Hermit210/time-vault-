"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
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

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "Expired";

  const { days, hours, minutes, seconds: secs } = getTimeBreakdown(seconds);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function formatAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              {type === "owner" ? "Your Vault" : "Inheritance Vault"}
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              {formatAddress(vault.publicKey)}
            </CardDescription>
          </div>
          <Badge
            variant={urgency === "danger" ? "destructive" : urgency === "warning" ? "default" : "secondary"}
            className={
              urgency === "safe" && !isExpired
                ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                : ""
            }
          >
            {urgency === "danger"
              ? isExpired ? "Expired" : "Urgent"
              : urgency === "warning"
              ? "Action Needed"
              : "Active"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {type === "owner" ? "Beneficiary" : "Owner"}
            </span>
            <code className="text-xs">
              {formatAddress(type === "owner" ? vault.beneficiary : vault.owner)}
            </code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Token Mint</span>
            <code className="text-xs">{formatAddress(vault.mint)}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Balance</span>
            <span className="font-medium">{balance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Timeout Period</span>
            <span className="font-medium">
              {Math.floor(vault.timeout / 86400)} days
            </span>
          </div>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            urgency === "danger"
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
              : urgency === "warning"
              ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
              : "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
          }`}
        >
          <div className="flex items-start gap-3">
            <Clock
              className={`h-5 w-5 mt-0.5 ${
                urgency === "danger"
                  ? "text-red-600 dark:text-red-400"
                  : urgency === "warning"
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            />
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  urgency === "danger"
                    ? "text-red-900 dark:text-red-100"
                    : urgency === "warning"
                    ? "text-yellow-900 dark:text-yellow-100"
                    : "text-green-900 dark:text-green-100"
                }`}
              >
                {type === "owner"
                  ? isExpired
                    ? "⚠️ Check-in Overdue!"
                    : "Next Check-in"
                  : canClaim
                  ? "✓ Ready to Claim"
                  : "Available to Claim"}
              </p>

              {/* Time Display */}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {(() => {
                  const { days, hours, minutes, seconds } = getTimeBreakdown(Math.abs(timeRemaining));
                  const timeColor = urgency === "danger"
                    ? "text-red-700 dark:text-red-300"
                    : urgency === "warning"
                    ? "text-yellow-700 dark:text-yellow-300"
                    : "text-green-700 dark:text-green-300";

                  return (
                    <>
                      {days > 0 && (
                        <div className="flex items-baseline gap-0.5">
                          <span className={`text-2xl font-bold tabular-nums ${timeColor}`}>{days}</span>
                          <span className={`text-xs font-medium ${timeColor}`}>d</span>
                        </div>
                      )}
                      {(days > 0 || hours > 0) && (
                        <div className="flex items-baseline gap-0.5">
                          <span className={`text-2xl font-bold tabular-nums ${timeColor}`}>{hours}</span>
                          <span className={`text-xs font-medium ${timeColor}`}>h</span>
                        </div>
                      )}
                      {(days > 0 || hours > 0 || minutes > 0) && (
                        <div className="flex items-baseline gap-0.5">
                          <span className={`text-2xl font-bold tabular-nums ${timeColor}`}>{minutes}</span>
                          <span className={`text-xs font-medium ${timeColor}`}>m</span>
                        </div>
                      )}
                      <div className="flex items-baseline gap-0.5">
                        <span className={`text-2xl font-bold tabular-nums ${timeColor}`}>{seconds}</span>
                        <span className={`text-xs font-medium ${timeColor}`}>s</span>
                      </div>
                      {isExpired && type === "owner" && (
                        <span className={`text-sm font-medium ${timeColor}`}>ago</span>
                      )}
                    </>
                  );
                })()}
              </div>

              <p
                className={`text-xs mt-2 ${
                  urgency === "danger"
                    ? "text-red-700 dark:text-red-300"
                    : urgency === "warning"
                    ? "text-yellow-700 dark:text-yellow-300"
                    : "text-green-700 dark:text-green-300"
                }`}
              >
                {type === "owner"
                  ? isExpired
                    ? "Your beneficiary can now claim this vault"
                    : urgency === "danger"
                    ? "🔔 Check in urgently needed!"
                    : urgency === "warning"
                    ? "⏰ Check-in needed soon"
                    : "✓ All good - check in to keep your vault active"
                  : canClaim
                  ? "Owner has been inactive - you can claim now"
                  : "Wait for the deadline to claim"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
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
                    Cancelling...
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
                    Processing...
                  </>
                ) : (
                  "Check In"
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
                  Processing...
                </>
              ) : (
                "Claim Vault"
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

