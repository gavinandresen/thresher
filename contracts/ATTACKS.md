# Possible attacks and mitigations

## Miners

Since all the entropy comes from block hashes, miners can throw away
blocks that don't produce hashes they like (that will win for them or
their friends or somebody paying them to produce favorable hashes).

See "On Bitcoin as a public randomess source" by Bonneau, Clark, and
Goldfeder for an analysis of the costs to miners:
    https://pdfs.semanticscholar.org/ebae/9c7d91ea8b6a987642040a2142cc5ea67f7d.pdf

... but that paper doesn't account for 'uncle' blocks. A miner can decline to
announce a losing block at height N, wait for another block at height N,
THEN announce the losing block and expect to get the 'uncle' block reward
(7/8 of the normal block reward).

So the block reward given up is 1/8 * 2 == 0.25 ETH, which gives us the maximum
win amount.

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
