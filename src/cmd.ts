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

  program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
