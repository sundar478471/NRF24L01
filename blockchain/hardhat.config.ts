import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load parent or local .env file
dotenv.config({ path: "../.env" });

const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || "";
const BLOCKCHAIN_PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    polygon: {
      url: BLOCKCHAIN_RPC_URL,
      accounts: BLOCKCHAIN_PRIVATE_KEY ? [BLOCKCHAIN_PRIVATE_KEY] : [],
      chainId: Number(process.env.BLOCKCHAIN_CHAIN_ID || 137),
    },
  },
};

export default config;
