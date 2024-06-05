import * as dotenv from "dotenv";
dotenv.config();

const { L1_RPC_URL, L2_RPC_URL } = process.env;

export interface IChainConfig {
  L1RpcUrl: string;
  L2RpcUrl: string;
  StartBlock: number;
  ShortName: string;
  Contracts: {
    ScrollChain: string;
    L2MessageQueue: string;
    L2ScrollMessenger: string;
  };
}

export const CHAIN_CONFIG: Record<string, IChainConfig> = {
  scroll: {
    L1RpcUrl: L1_RPC_URL ?? "https://rpc.ankr.com/eth",
    L2RpcUrl: L2_RPC_URL ?? "https://rpc.ankr.com/scroll",
    StartBlock: 18318214,
    ShortName: "scroll",
    Contracts: {
      ScrollChain: "0xa13BAF47339d63B743e7Da8741db5456DAc1E556",
      L2MessageQueue: "0x5300000000000000000000000000000000000000",
      L2ScrollMessenger: "0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC",
    },
  },
  "scroll-sepolia": {
    L1RpcUrl: L1_RPC_URL ?? "https://rpc.ankr.com/eth_sepolia",
    L2RpcUrl: L2_RPC_URL ?? "https://rpc.ankr.com/scroll_sepolia_testnet",
    StartBlock: 4041342,
    ShortName: "scroll-sepolia",
    Contracts: {
      ScrollChain: "0x2D567EcE699Eabe5afCd141eDB7A4f2D0D6ce8a0",
      L2MessageQueue: "0x5300000000000000000000000000000000000000",
      L2ScrollMessenger: "0xBa50f5340FB9F3Bd074bD638c9BE13eCB36E603d",
    },
  },
};
