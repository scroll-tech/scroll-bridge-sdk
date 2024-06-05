/* eslint-disable @typescript-eslint/prefer-for-of */
import type { Block, TransactionResponse } from "ethers";
import { JsonRpcProvider, Transaction } from "ethers";
import * as fs from "fs";
import * as path from "path";

import type { IChainConfig } from "../common";
import {
  BlockSyncStep,
  CHAIN_CONFIG,
  L2MessageQueueInterface,
  MaxConcurrentCall,
  ScrollChainInterface,
} from "../common";
import { WithdrawTrie } from "./withdraw-trie";

interface IBatchIndexerMetadata {
  LastCommittedBatchIndex: number;
  LastFinalizedBatchIndex: number;
  LastL1Block: number;
  WithdrawTrie: {
    NextMessageNonce: number;
    Height: number;
    Branches: Array<string>;
  };
}

interface IWithdrawCache {
  block: number;
  queueIndex: number;
  messageHash: string;
  transactionHash: string;
}

interface IWithdraw {
  queueIndex: number;
  messageHash: string;
  transactionHash: string;
  proof: string;
}

interface IBatch {
  index: number;
  batchHash: string;
  commitTxHash: string;
  commitTimestamp: number;
  finalizeTxHash?: string;
  withdrawRoot?: string;
  blockRange: [number, number];
  withdrawals: Array<IWithdraw>;
}

function decodeBlockRange(data: string): [number, number] {
  const [_version, _parentBatchHeader, chunks, _skippedL1MessageBitmap] = ScrollChainInterface.decodeFunctionData(
    "commitBatch",
    data,
  ) as any as [number, string, Array<string>, string];
  let startBlock: number = -1;
  let endBlock: number = -1;
  for (const chunk of chunks) {
    // skip '0x', parse 1st byte as `numBlocks`
    const numBlocks = parseInt(chunk.slice(2, 4), 16);
    for (let i = 0; i < numBlocks; ++i) {
      // each `blockContext` is 60 bytes (120 chars) long and
      // contains `blockNumber` as its first 8-byte field.
      const blockNumber = parseInt(chunk.slice(4 + i * 120, 4 + i * 120 + 16), 16);
      if (startBlock === -1) {
        startBlock = blockNumber;
      }
      endBlock = blockNumber;
    }
  }
  return [startBlock, endBlock];
}

export class BatchIndexer {
  public readonly batchDir: string;

  public readonly config: IChainConfig;

  public readonly l1Provider: JsonRpcProvider;

  public readonly l2Provider: JsonRpcProvider;

  public readonly metadata: IBatchIndexerMetadata;

  public readonly withdrawTrie: WithdrawTrie;

  private readonly committedBatches: Array<IBatch>;

  private batchCache: Record<string, Array<IBatch>>;

  private readonly metadataFilepath: string;

  private readonly finalizedBatchFileDir: string;

  private readonly committedBatchFilepath: string;

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  constructor(network: string, cacheDir: string) {
    this.config = CHAIN_CONFIG[network];
    this.batchDir = path.join(cacheDir, this.config.ShortName, "batch");
    this.metadataFilepath = path.join(this.batchDir, "metadata.json");
    this.committedBatchFilepath = path.join(this.batchDir, "committed.json");
    this.finalizedBatchFileDir = path.join(this.batchDir, "finalized");
    if (!fs.existsSync(this.finalizedBatchFileDir)) {
      fs.mkdirSync(this.finalizedBatchFileDir, { recursive: true });
    }
    this.l1Provider = new JsonRpcProvider(this.config.L1RpcUrl);
    this.l2Provider = new JsonRpcProvider(this.config.L2RpcUrl);

    // load metadata
    if (!fs.existsSync(this.metadataFilepath)) {
      this.metadata = {
        LastCommittedBatchIndex: 0,
        LastFinalizedBatchIndex: 0,
        LastL1Block: CHAIN_CONFIG[network].StartBlock,
        WithdrawTrie: {
          Height: -1,
          Branches: [],
          NextMessageNonce: 0,
        },
      };
    } else {
      this.metadata = JSON.parse(fs.readFileSync(this.metadataFilepath).toString());
    }

    // load committed batches
    if (!fs.existsSync(this.committedBatchFilepath)) {
      this.committedBatches = [];
    } else {
      this.committedBatches = JSON.parse(fs.readFileSync(this.committedBatchFilepath).toString());
    }
    this.batchCache = {};

    this.withdrawTrie = new WithdrawTrie();
    this.withdrawTrie.initialize(
      this.metadata.WithdrawTrie.NextMessageNonce,
      this.metadata.WithdrawTrie.Height,
      this.metadata.WithdrawTrie.Branches,
    );
  }

  public saveBatches(): void {
    // save finalized
    for (const [monthString, batches] of Object.entries(this.batchCache)) {
      const filepath = path.join(this.finalizedBatchFileDir, monthString + ".json");
      fs.writeFileSync(filepath, JSON.stringify(batches));
    }
    this.batchCache = {};
    // save committed
    fs.writeFileSync(this.committedBatchFilepath, JSON.stringify(this.committedBatches));
  }

  public saveMetadata(): void {
    fs.writeFileSync(this.metadataFilepath, JSON.stringify(this.metadata, undefined, 2));
  }

  public async run(): Promise<void> {
    const CommitBatchTopicHash = ScrollChainInterface.getEvent("CommitBatch").topicHash;
    const RevertBatchTopicHash = ScrollChainInterface.getEvent("RevertBatch").topicHash;
    const FinalizeBatchTopicHash = ScrollChainInterface.getEvent("FinalizeBatch").topicHash;

    // sync up to latest l1 block
    const latestL1Block = await this.l1Provider.getBlockNumber();
    const syncToBlock = latestL1Block - 6;
    for (let lastBlock = this.metadata.LastL1Block; lastBlock < syncToBlock; ) {
      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(fromBlock + BlockSyncStep - 1, syncToBlock);
      lastBlock = toBlock;
      const logs = await this.l1Provider.getLogs({
        fromBlock,
        toBlock,
        address: [this.config.Contracts.ScrollChain],
        topics: [[CommitBatchTopicHash, RevertBatchTopicHash, FinalizeBatchTopicHash]],
      });
      console.log(`L1 Sync from ${fromBlock} to ${toBlock}, ${logs.length} logs`);

      const txHashes: Array<string> = [];
      const blocks: Array<number> = [];
      for (let index = 0; index < logs.length; ++index) {
        const log = logs[index];
        if (log.topics[0] === CommitBatchTopicHash) {
          txHashes.push(log.transactionHash);
          blocks.push(log.blockNumber);
        }
      }

      // cache all transactions and block timestamp
      const blockCache: Record<number, Block> = await this.cacheBlocks(blocks);
      const txCache: Record<string, TransactionResponse> = await this.cacheTransactions(txHashes);

      // cache all withdraw events
      let startBlock = 1e9;
      let endBlock = -1;
      for (const tx of Object.values(txCache)) {
        const [x, y] = decodeBlockRange(tx.data);
        if (x < startBlock) startBlock = x;
        if (y > endBlock) endBlock = y;
      }
      const withdrawalCache = await this.cacheWithdrawals(startBlock, endBlock);

      for (let index = 0; index < logs.length; ++index) {
        const log = logs[index];
        if (log.topics[0] === CommitBatchTopicHash) {
          const tx = txCache[log.transactionHash];
          const blockRange = decodeBlockRange(tx!.data);
          const blockTimestamp = blockCache[log.blockNumber].timestamp;
          const withdrawals = this.fetchL2Withdrawals(blockRange[0], blockRange[1], withdrawalCache);

          const event = ScrollChainInterface.decodeEventLog("CommitBatch", log.data, log.topics);
          this.committedBatches.push({
            index: Number(event.batchIndex),
            batchHash: event.batchHash,
            commitTxHash: log.transactionHash,
            commitTimestamp: blockTimestamp,
            blockRange: blockRange,
            withdrawals: withdrawals,
          });
          console.log(
            "CommitBatch:",
            `index[${event.batchIndex}]`,
            `hash[${event.batchHash}]`,
            `blockRange[${blockRange}]`,
          );
          this.metadata.LastCommittedBatchIndex = Number(event.batchIndex);
        } else if (log.topics[0] === RevertBatchTopicHash) {
          const event = ScrollChainInterface.decodeEventLog("RevertBatch", log.data, log.topics);
          const batch = this.committedBatches.pop();
          if (batch?.index !== Number(event.batchIndex) || batch?.batchHash !== event.batchHash) {
            throw Error(`RevertBatch failed, expected[${event.batchIndex}] found[${batch?.index}]`);
          }
          console.log("RevertBatch:", `index[${event.batchIndex}]`, `hash[${event.batchHash}]`);
          this.metadata.LastCommittedBatchIndex -= 1;
        } else if (log.topics[0] === FinalizeBatchTopicHash) {
          const event = ScrollChainInterface.decodeEventLog("FinalizeBatch", log.data, log.topics);
          const batch = this.committedBatches.shift();
          if (batch?.index !== Number(event.batchIndex) || batch?.batchHash !== event.batchHash) {
            throw Error(`FinalizeBatch failed, expected[${event.batchIndex}] found[${batch?.index}]`);
          }
          batch.finalizeTxHash = log.transactionHash;
          const d = new Date(batch.commitTimestamp * 1000);
          const batches = this.getBatchByMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
          batches.push(batch);
          console.log("FinalizeBatch:", `index[${event.batchIndex}]`, `hash[${event.batchHash}]`);
          this.metadata.LastFinalizedBatchIndex = Number(event.batchIndex);
        }
      }
      this.metadata.LastL1Block = toBlock;
      if (logs.length > 0) {
        // save data
        this.metadata.WithdrawTrie = this.withdrawTrie.export();
        this.saveBatches();
        this.saveMetadata();
      } else {
        this.saveMetadata();
      }
    }
  }

  public getBatchByMonth(year: number, month: number): Array<IBatch> {
    const monthString = `${year}${month.toString().padStart(2, "0")}`;
    if (this.batchCache[monthString] !== undefined) {
      return this.batchCache[monthString];
    }
    const filepath = path.join(this.finalizedBatchFileDir, monthString + ".json");
    let batches: Array<IBatch> = [];
    if (fs.existsSync(filepath)) {
      batches = JSON.parse(fs.readFileSync(filepath).toString());
    }
    this.batchCache[monthString] = batches;
    return batches;
  }

  private async cacheTransactions(hashes: Array<string>): Promise<Record<string, TransactionResponse>> {
    const txCache: Record<string, TransactionResponse> = {};
    for (let i = 0; i < hashes.length; i += MaxConcurrentCall) {
      const tasks = [];
      for (let j = i; j < hashes.length && j - i < MaxConcurrentCall; ++j) {
        tasks.push(this.l1Provider.getTransaction(hashes[j]));
      }
      console.log("L1 Fetch transactions, count:", tasks.length);
      const results = await Promise.all(tasks);
      for (const tx of results) {
        txCache[tx!.hash] = tx!;
      }
    }
    return txCache;
  }

  private async cacheBlocks(blocks: Array<number>): Promise<Record<number, Block>> {
    const blockCache: Record<string, Block> = {};
    for (let i = 0; i < blocks.length; i += MaxConcurrentCall) {
      const tasks = [];
      for (let j = i; j < blocks.length && j - i < MaxConcurrentCall; ++j) {
        tasks.push(this.l1Provider.getBlock(blocks[j]));
      }
      console.log("L1 Fetch blocks, count:", tasks.length);
      const results = await Promise.all(tasks);
      for (const b of results) {
        blockCache[b!.number] = b!;
      }
    }
    return blockCache;
  }

  private async cacheWithdrawals(startBlock: number, endBlock: number): Promise<Array<IWithdrawCache>> {
    const AppendMessageTopicHash = L2MessageQueueInterface.getEvent("AppendMessage").topicHash;
    const withdrawals: Array<IWithdrawCache> = [];
    while (startBlock <= endBlock) {
      const fromBlock = startBlock;
      const toBlock = Math.min(fromBlock + BlockSyncStep - 1, endBlock);
      startBlock = toBlock + 1;
      const logs = await this.l2Provider.getLogs({
        fromBlock,
        toBlock,
        address: [this.config.Contracts.L2MessageQueue],
        topics: [[AppendMessageTopicHash]],
      });
      console.log(`L2 Sync from ${fromBlock} to ${toBlock}, ${logs.length} logs`);
      for (let index = 0; index < logs.length; ++index) {
        const log = logs[index];
        if (log.topics[0] === AppendMessageTopicHash) {
          const event = L2MessageQueueInterface.decodeEventLog("AppendMessage", log.data, log.topics);
          withdrawals.push({
            block: log.blockNumber,
            queueIndex: Number(event.index),
            messageHash: event.messageHash,
            transactionHash: log.transactionHash,
          });
        }
      }
    }
    return withdrawals;
  }

  private fetchL2Withdrawals(startBlock: number, endBlock: number, cache: Array<IWithdrawCache>): Array<IWithdraw> {
    const withdrawals = cache
      .filter((x) => startBlock <= x.block && x.block <= endBlock)
      .map((w) => {
        return {
          queueIndex: w.queueIndex,
          messageHash: w.messageHash,
          transactionHash: w.transactionHash,
          proof: "0x",
        };
      });
    const proofs = this.withdrawTrie.appendMessages(withdrawals.map((w) => w.messageHash));
    for (let i = 0; i < proofs.length; ++i) {
      withdrawals[i].proof = proofs[i];
    }
    return withdrawals;
  }

  private async tryFetchCacheFromAWS(network: string, cacheDir: string): Promise<void> {}
}
