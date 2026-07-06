"use server";
import { GATEWAY_ENDPOINT } from "./consts";

async function buildGatewayTransaction(tx: string, network: "devnet" | "mainnet"): Promise<{
  transaction: string;
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: string;
  };
}> {
  const gatewayUrl = `${GATEWAY_ENDPOINT}/v1/${network}?apiKey=${process.env["GATEWAY_API_KEY"]}`;

  console.log(gatewayUrl);
  console.log(tx);

  const buildGatewayTransactionResponse = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "timevault",
      jsonrpc: "2.0",
      method: "buildGatewayTransaction",
      params: [tx],
    }),
  });

  if (!buildGatewayTransactionResponse.ok) {
    throw new Error("Failed to build gateway transaction");
  }

  const data = await buildGatewayTransactionResponse.json();
  console.log(data);

  const {
    result: { transaction: encodedTransaction, latestBlockhash },
  } = data as {
    result: {
      transaction: string;
      latestBlockhash: {
        blockhash: string;
        lastValidBlockHeight: string;
      };
    };
  };

  return {
    transaction: encodedTransaction,
    latestBlockhash: {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
  };
}

async function sendGatewayTransaction(tx: string, network: "devnet" | "mainnet"): Promise<string> {
  const gatewayUrl = `${GATEWAY_ENDPOINT}/v1/${network}?apiKey=${process.env["GATEWAY_API_KEY"]}`;
  const sendGatewayTransactionResponse = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "timevault",
      jsonrpc: "2.0",
      method: "sendTransaction",
      params: [tx],
    }),
  });

  if (!sendGatewayTransactionResponse.ok) {
    throw new Error("Failed to send gateway transaction");
  }

  const gatewayResponse = await sendGatewayTransactionResponse.json();
  return gatewayResponse.result;
}

export { buildGatewayTransaction, sendGatewayTransaction };