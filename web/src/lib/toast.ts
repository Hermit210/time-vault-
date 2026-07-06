import { toast } from "sonner";

export function getExplorerUrl(
  signature: string,
  network: "devnet" | "mainnet"
): string {
  const cluster = network === "mainnet" ? "" : `?cluster=${network}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

export function toastSuccess(
  message: string,
  signature: string,
  network: "devnet" | "mainnet"
) {
  const explorerUrl = getExplorerUrl(signature, network);

  toast.success(message, {
    description: `View on Solana Explorer (${network})`,
    action: {
      label: "View",
      onClick: () => window.open(explorerUrl, "_blank"),
    },
    duration: 5000,
  });
}

export function toastError(message: string, error?: any) {
  const errorMessage = error?.message || error?.toString() || "Unknown error";

  toast.error(message, {
    description: errorMessage,
    duration: 7000,
  });
}

