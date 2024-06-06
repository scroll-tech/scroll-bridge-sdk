import type { OptionValues } from "commander";
import { Command } from "commander";

import { BatchIndexer } from "./indexer";
import { CHAIN_CONFIG } from "./common";

const program = new Command();
program.version("1.0.0");

async function runBatchIndexer(opts: OptionValues): Promise<void> {
  const indexer = new BatchIndexer(opts.network, opts.dir);
  await indexer.run();
}

async function runSearch(opts: OptionValues): Promise<void> {
  const indexer = new BatchIndexer(opts.network, opts.dir);
  if (opts.txHash) {
    const withdrawals = indexer.getWithdrawalsByTxHash(opts.txHash);
    for (const [b, w] of withdrawals) {
      console.log(JSON.stringify({ batchIndex: b.index, messageHash: w.messageHash, merkleProof: w.proof }));
    }
    if (withdrawals.length === 0) {
      console.log("No withdrawal exists");
    }
  } else if (opts.messageHash) {
    const withdrawal = indexer.getWithdrawalByMessageHash(opts.messageHash);
    if (withdrawal) {
      const [b, w] = withdrawal;
      console.log(JSON.stringify({ batchIndex: b.index, messageHash: w.messageHash, merkleProof: w.proof }));
    } else {
      console.log("No withdrawal exists");
    }
  }
}

async function main(): Promise<void> {
  const index = program.command("index").description("Blockchain state indexing utils");
  index
    .command("batch")
    .option("-n, --network <network>", "The network", Object.keys(CHAIN_CONFIG))
    .option("-d, --dir <data dir>", "The directory to store indexed on-chain data")
    .description("index batches")
    .action(async (_name, options, _command) => {
      runBatchIndexer(options.opts());
    });

  index
    .command("search")
    .option("-n, --network <network>", "The network", Object.keys(CHAIN_CONFIG))
    .option("-d, --dir <data dir>", "The directory to store indexed on-chain data")
    .option("-t, --tx-hash <tx hash>", "The transaction hash of the withdrawal")
    .option("-m, --message-hash <message hash>", "The message hash of the withdrawal")
    .description("search withdrawal proof by tx hash or message hash")
    .action(async (_name, options, _command) => {
      runSearch(options.opts());
    });

  program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
