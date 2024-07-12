# Document @scroll-tech/scroll-bridge-sdk

## Overview

This documentation will help you with following things:

- How to run scroll-bridge-sdk
- How to use scroll-bridge-sdk
- How scroll-bridge-sdk works

---

## How to run scroll-bridge-sdk

Run scroll-bridge-sdk will index data and generate withdraws proofs.

### Requirements

This repository requires `node` version>=20.12.2 and `yarn` to be previously installed.

- **Node.js:** https://nodejs.org/en/download/package-manager
- **Yarn:** https://www.npmjs.com/package/yarn

### Config

1. Create `.env` file on the root directory of the repo
2. Copy config variables from example file `.env.example`

Details about the environment variables:

- `L1_SCROLL_RPC_URL`: The layer1 mainnet rpc used, defaults to `https://rpc.ankr.com/eth`
- `L2_SCROLL_RPC_URL`: The layer2 mainnet rpc used, defaults to `https://rpc.scroll.io`
- `L1_SCROLL_SEPOLIA_RPC_URL`: The layer1 Sepolia rpc used, defaults to `https://rpc.ankr.com/eth_sepolia`
- `L2_SCROLL_SEPOLIA_RPC_URL`: The layer2 Sepolia rpc used, defaults to `https://sepolia-rpc.scroll.io`
- `BLOCK_SYNC_STEP`: The step used to get logs, defaults to 1000. (warning: some rpc node might not support, if set it too large)
- `MAX_CONCURRENT_CALL`: The max concurrent threads to request data from rpc, defaults to `2`

### Running the Indexer

1. Install packages

```bash
yarn install
```

2. Indexing data

```bash
yarn index:batch:scroll
```

For faster indexing, you can optionally run following commands first:

```bash
curl https://withdraw-proof.s3.us-west-2.amazonaws.com/scroll.batch.tar.gz  --output ./state-cache/scroll.batch.tar.gz
tar xvf state-cache/scroll.batch.tar.gz
```

If you want to index testnet data, replace `scroll` with `scroll-sepolia`.

## How to use scroll-bridge-sdk

Use scroll-bridge-sdk to get withdraws proofs.

1. Get the transaction hash or message hash of your withdraw
2. Get corresponding withdraw proof, run:

```bash
yarn index:search:scroll --tx-hash <tx hash>
```

or

```bash
yarn index:search:scroll --message-hash <message hash>
```

Then you will get a JSON response, which contain fields `batchIndex`, `messageHash` and `merkleProof`.

## How scroll-bridge-sdk works

scroll-bridge-sdk retrieves withdraw logs, build merkle trie, and generate merkle proofs for withdraws.

### Workflow

- 1. Fetch `CommitBatch`, `RevertBatch` and `FinalizeBatch` event from layer1.
- 2. If it's `CommitBatch`
  - Decode `CommitBatch` event, and get the layer2 block range of this batch
  - Fetch `AppendMessage` events(which contains withdraw message) in the block range on layer2
  - Append withdraw message hashes to withdraw trie, and generate corresponding withdraw merkle proofs
  - Save related information(including withdraw merkle proofs) for the batch into file `.state/scroll/batch/committed.json`
- 3. If it's `RevertBatch`
  - Decode `RevertBatch` event, and get the batch index
  - Remove corresponding batch from file `.state/scroll/batch/committed.json`
- 4. If it's `FinalizeBatch`
  - Decode `FinalizeBatch` event, and get the batch index
  - Remove corresponding batch from file `.state/scroll/batch/committed.json`
  - Save batch into file `.state/scroll/batch/finalized/year+month.json`
- 5. Loop back to step 1, until we finished to fetch the latest event

### Key Concepts and Functionality

Under directory `src/indexer`, There are two key files:

- `batch-indexer.ts` contains logic how we index bridge data, and how we search withdraw proof from indexed data.
- `withdraw-trie.ts` contains logic how we build withdraw trie, and generate withdraw proof.
