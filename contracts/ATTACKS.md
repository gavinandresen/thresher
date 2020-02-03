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

There are two edge cases where the win/lose decision is **not** based on
a future block, because only the last 256 block hashes are available
to the contract:

1. If the contract balance is less than the payout amount for more
than 256 blocks after the deposit.
2. If there is a gap of more than 256 blocks between deposits

In those cases, the win/lose decision re-uses the hash state of the
contract at the time of the initial deposit. So if a depositor knows
that the contract will have very few deposits, they could:

Submit always-win deposits to the contract until it's internal hash
state is favorable.
Submit a deposit that they know will win, if more than 256 blocks go
by before the win/lose decision is triggered.

The first edge case can be mitigated by "priming" the contract with
some ETH, so it always has enough to pay out after two blocks. Doing
that is a good idea for usability, anyway, and is easily accomplished
by including some initial ETH when it is deployed.

The second can be mitigated by ensuring that there is a steady stream
of deposits to trigger win/lose decisions. I (or anybody) could run a
process that watches the chain and makes an 'always wins' deposit
(e.g. deposit 0.01 ETH to win 0.01 ETH) if more than 200 blocks have
gone by since a deposit from somebody else. If I did the math right,
the cost would be less than 50 US cents per day at current gas
prices.
