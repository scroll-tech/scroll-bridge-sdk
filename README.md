# @scroll-tech/scroll-bridge-sdk

## Batch indexing

To indexing the data from beginning, you can run the following command. It would take about 2 days to download.

```bash
yarn index:batch:scroll
```

To speed up the indexing process, you can download latest snapshot which is built by Scroll bi-weekly. It would take about 5 minutes to index from snapshot to latest state.

```bash
curl <url TBD>
tar xvf state-cache/scroll.batch.tar.gz
```

And also use your own Ethereum and Scroll rpc nodes by creating `.env` file with following fields.

```
L1_SCROLL_RPC_URL=<Ethereum rpc url>
L2_SCROLL_RPC_URL=<Scroll rpc url>
BLOCK_SYNC_STEP=1000
MAX_CONCURRENT_CALL=10
```

If you want to index testnet data, replace `scroll` with `scroll-sepolia`.

### Find withdraw proof by transaction hash or message hash

```bash
yarn index:search:scroll --tx-hash <tx hash>
yarn index:search:scroll --message-hash <message hash>
```
