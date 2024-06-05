import { ZeroHash, concat, keccak256 } from "ethers";

const MaxHeight = 40;

// updateBranchWithNewMessage update the branches to latest with new message and return the merkle proof for the message.
function updateBranchWithNewMessage(
  zeroes: Array<string>,
  branches: Array<string>,
  index: number,
  msgHash: string,
): Array<string> {
  let root = msgHash;
  const merkleProof: Array<string> = [];
  let height = 0;
  for (height = 0; index > 0; height++) {
    if (index % 2 === 0) {
      // it may be used in next round.
      branches[height] = root;
      merkleProof.push(zeroes[height]);
      // it's a left child, the right child must be null
      root = keccak256(concat([root, zeroes[height]]));
    } else {
      // it's a right child, use previously computed hash
      root = keccak256(concat([branches[height], root]));
      merkleProof.push(branches[height]);
    }
    index >>= 1;
  }
  branches[height] = root;
  return merkleProof;
}

export class WithdrawTrie {
  public nextMessageNonce: number;

  public height: number;

  public branches: Array<string>;

  public readonly zeroes: Array<string>;

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  constructor() {
    this.branches = new Array<string>(MaxHeight);
    this.zeroes = new Array<string>(MaxHeight);
    this.height = -1;
    this.nextMessageNonce = 0;

    this.zeroes[0] = ZeroHash;
    for (let i = 1; i < MaxHeight; ++i) {
      this.zeroes[i] = keccak256(concat([this.zeroes[i - 1], this.zeroes[i - 1]]));
    }
    this.branches.fill(ZeroHash);
  }

  public initialize(currentMessageNonce: number, height: number, branches: Array<string>): void {
    while (branches.length < MaxHeight) {
      branches.push(ZeroHash);
    }
    this.nextMessageNonce = currentMessageNonce;
    this.height = height;
    this.branches = branches;
  }

  public appendMessages(hashes: Array<string>): Array<string> {
    const length = hashes.length;
    if (length === 0) return [];

    const cache = new Array<Map<number, string>>(MaxHeight);
    for (let h = 0; h < MaxHeight; ++h) {
      cache[h] = new Map();
    }

    // cache all branches will be used later.
    if (this.nextMessageNonce !== 0) {
      let index = this.nextMessageNonce;
      for (let h = 0; h <= this.height; h++) {
        if (index % 2 === 1) {
          // right child, `w.branches[h]` is the corresponding left child
          // the index of left child should be `index ^ 1`.
          cache[h].set(index ^ 1, this.branches[h]);
        }
        index >>= 1;
      }
    }
    // cache all new leaves
    for (let i = 0; i < length; i++) {
      cache[0].set(this.nextMessageNonce + i, hashes[i]);
    }

    // build withdraw trie with new hashes
    let minIndex = this.nextMessageNonce;
    let maxIndex = this.nextMessageNonce + length - 1;
    for (let h = 0; maxIndex > 0; h++) {
      if (minIndex % 2 === 1) {
        minIndex--;
      }
      if (maxIndex % 2 === 0) {
        cache[h].set(maxIndex ^ 1, this.zeroes[h]);
      }
      for (let i = minIndex; i <= maxIndex; i += 2) {
        cache[h + 1].set(i >> 1, keccak256(concat([cache[h].get(i)!, cache[h].get(i ^ 1)!])));
      }
      minIndex >>= 1;
      maxIndex >>= 1;
    }

    // update branches using hashes one by one
    for (let i = 0; i < length; i++) {
      const proof = updateBranchWithNewMessage(this.zeroes, this.branches, this.nextMessageNonce, hashes[i]);
      this.nextMessageNonce += 1;
      this.height = proof.length;
    }

    const proofs: Array<string> = new Array(length);
    // retrieve merkle proof from cache
    for (let i = 0; i < length; i++) {
      let index = this.nextMessageNonce + i - length;
      const merkleProof: Array<string> = [];
      for (let h = 0; h < this.height; h++) {
        merkleProof.push(cache[h].get(index ^ 1)!);
        index >>= 1;
      }
      proofs[i] = concat(merkleProof);
    }

    return proofs;
  }

  public export(): {
    NextMessageNonce: number;
    Height: number;
    Branches: Array<string>;
  } {
    return {
      NextMessageNonce: this.nextMessageNonce,
      Height: this.height,
      Branches: this.branches,
    };
  }
}
