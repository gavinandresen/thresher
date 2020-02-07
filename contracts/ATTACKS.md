# Possible attacks and mitigations

## Miners

Since all the entropy comes from block hashes, miners can throw away
blocks that don't produce hashes they like (that will win for them or
their friends or somebody paying them to produce favorable hashes).

See "On Bitcoin as a public randomess source" by Bonneau, Clark, and
Goldfeder for an analysis of the costs to miners:
    https://pdfs.semanticscholar.org/ebae/9c7d91ea8b6a987642040a2142cc5ea67f7d.pdf

Cheating only pays if miners can win more than twice what they earn
mining a block; the reward is currently 2 ETH (plus fees), so we're OK 
using the block hash as our randomness source as long a cheating miner
can't win more than 4 ETH. The contract constructor doesn't allow
payouts of more than 4 ETH, and the plan is to deploy this contract
with a maximum payout of 1 ETH.

(This should get better with the beacon chain of eth2 and the use of a
verifiable delay function (VDF) and proof-of-stake.)

Miners could collude to prevent deposits from anybody but miners (or
their friends)... but because the winnings are paid out from deposits
doing that would accomplish nothing. They would be winning back their
own money.

## Depositors

Depositors don't know future block hashes when they deposit into the
contract, so as long as the win/lose decision is based on a future
block **AND** they cannot influence **WHICH** block is used for the decision
they cannot gain an unfair advantage.

Unless I made a mistake, the contract's payout code never pays an
entry until after it has been mined, and it uses the hash of a block
after the entry to contribute to the random seed.

Entries older than 256 blocks always lose (because contracts only have
access to the last 256 block hashes). I plan on running a process that
watches the contract state and triggers win/lose decisions after 200
blocks (if necessary).
