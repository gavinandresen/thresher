/*
* Thresher accumulates small deposits until there are enough to fund a full Tornado.cash
* deposit.
*
* The problem: Tornado.cash deposits and withdrawals are fixed-size, with a minimum
* size (0.1 ETH in the case of ether). Anybody that uses tornado properly will accumulate
* less-than-minimum amounts of ETH in different addresses and be unable to spend
* them without compromising privacy.
*
* Solution: Accumulated 0.1 ETH or more, then sends 0.1 ETH back to one of the depositors,
* picked fairly at random (e.g. if you deposit 0.09 ETH  you have a 90% chance of ending up
* with 0.1 ETH)...  PLUS enough ETH to cover a Tornado.cash deposit.
*
* Winners are picked as a side effect of processing a new deposit at some current block height N.
*
* The hash of block N-1 is used as the random seed to pick a winner. However, to make cheating by
* miners even more costly (they must pay transaction fees to another miner to get their entries
* on the list), only deposits received before block N-1 can win.
*
* See "On Bitcoin as a public randomess source" by Bonneau, Clark, and Goldfeder for an
* analysis of miners trying to cheat by throwing away winning block hashes:
*    https://pdfs.semanticscholar.org/ebae/9c7d91ea8b6a987642040a2142cc5ea67f7d.pdf
* Cheating only pays if miners can win more than twice what they earn mining a block;
* the reward is currently 2 ETH (plus fees), so we're OK using the block hash as our
* randomness source as long a cheating miner can't win more than 4 ETH.
*/

pragma solidity ^0.5.8;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/*
* Double-ended queue of entries.
* Functions not used by Thresher (like popRight()) have been removed
* (resurrect them from git history if necessary)
*/
contract EntryDeque {
    struct Entry {
        uint256 amount;
        address payable depositor;
        uint256 blockNumber;
        uint256 gasprice;
    }
    mapping(uint256 => Entry) internal entries;
    uint256 internal nFirst = 2**255;
    uint256 internal nLast = nFirst - 1;

    function empty() internal view returns (bool) {
        return nLast < nFirst;
    }

    function first() internal view returns (uint256 _amount, address payable _depositor, uint256 _blockNumber, uint256 _gasprice) {
        require(!empty());

        _amount = entries[nFirst].amount;
        _depositor = entries[nFirst].depositor;
        _blockNumber = entries[nFirst].blockNumber;
        _gasprice = entries[nFirst].gasprice;
    }

    function popFirst() internal {
        require(!empty());

        delete entries[nFirst];
        nFirst += 1;
    }

    function pushLast(uint256 _amount, address payable _depositor, uint256 _blockNumber, uint256 _gasprice) internal {
        nLast += 1;
        entries[nLast] = Entry(_amount, _depositor, _blockNumber, _gasprice);
    }
}

contract Thresher is EntryDeque, ReentrancyGuard {
    bytes32 public randomHash;
    uint256 public payoutThreshold;
    uint256 public tornadoDepositGas; // Amount of gas for a Tornado deposit

    event Win(address indexed depositor);
    event Lose(address indexed depositor);

    /**
      @dev The constructor
      @param _payoutThreshold Amount to accumulate / pay out (e.g. 0.1 ether)
      @param _tornadoDepositGas How much gas a Tornado deposit costs (1 million)
    **/
    constructor(uint256 _payoutThreshold, uint256 _tornadoDepositGas) public {
        // Sanity check:
        payoutThreshold = _payoutThreshold;
        require(payoutThreshold > 0);
        require(payoutThreshold < 4 ether);

        tornadoDepositGas = _tornadoDepositGas;

        randomHash = keccak256(abi.encode("Eleven!"));
    }

    /**
      @dev Deposit funds; rejects too-large deposits.
    **/
    function deposit() external payable nonReentrant {
        uint256 v = msg.value;

        // If the user wins, they'll get the payout threshold plus enough
        // ether to pay for a tornado deposit. We use whatever gasprice that
        // their wallet used for this deposit to figure out how much
        // the withdrawal will be.
        uint256 withdrawAmount = payoutThreshold + tornadoDepositGas*tx.gasprice;

        // Don't allow ridiculous withdraw amounts that would otherwise be possible
        // be sending with a ridiculously large gasprice
        require(withdrawAmount <= 2*payoutThreshold);

        // And don't allow depositing more than threshold+gas-- prevents
        // users from losing coins by sending 1 ETH and 'winning' just 0.1
        require(v <= withdrawAmount, "Deposit amount too large");

        // Q: Any reason to fail if the msg.value is tiny (e.g. 1 wei)?
        // I can't see any reason to enforce a minimum; gas costs make attacks
        // expensive.

        uint256 currentBlock = block.number;
        pushLast(v, msg.sender, currentBlock, tx.gasprice);

        bool winner = false;
        uint256 amount;
        address payable depositor;
        uint256 blockNumber;
        uint256 gasprice;
        bytes32 hash = randomHash;
        
        // Maximum one payout per deposit, because multiple transfers could cost a lot of gas
        // ... but usability is better (faster win/didn't win decisions) if we keep going until
        // we either pay out or don't have any entries old enough to pay out:
        while (!winner && !empty()) {
            (amount, depositor, blockNumber, gasprice) = first();
            if (blockNumber > currentBlock-2) {
                break;
            }
            // amount is how much they put in, withdrawAmount is how much they will win if they win:
            withdrawAmount = payoutThreshold + tornadoDepositGas*gasprice;
            if (address(this).balance < withdrawAmount) {
                break;
            }

            popFirst();

            // a different hash is computed for every entry to make it more difficult for somebody
            // to arrange for their own entries to win
            bytes32 b = hash ^ blockhash(currentBlock-1);
            hash = keccak256(abi.encodePacked(b));

            if (amount >= pickWinningThreshold(randomHash, withdrawAmount)) {
                (bool success, ) = depositor.call.value(withdrawAmount)("");
                require(success, "Transfer to winner failed");
                emit Win(depositor);
                winner = true;
            }
            else {
                emit Lose(depositor);
            }
        }
        randomHash = hash;
    }

    // Return a number between 0 and max, given a random hash:
    function pickWinningThreshold(bytes32 hash, uint256 max) internal pure returns (uint256) {
        return uint256(hash) % max;

        /*
         Lets talk about modulo bias here, because I know somebody is going to complain.
         We could do this:
              https://github.com/pooltogether/pooltogether-contracts/blob/master/contracts/UniformRandomNumber.sol
         ... but is the extra code worth the gas cost?
         Lets play computer with uint256 (2**256) and the 10*17 (0.1 eth) threshold: compute
         how many values we should skip to avoid any bias:
         min = (2**256 - 10**17) % 10**17
             84007913129639936L  <<- The first 840 quadrillion hashes are biased!  But:
         2**256 / 84007913129639936L
              1378347407090416896591674552386804332932494391328937058907953L
         This is how many times we'd need to call this routine before running into modulo bias and
         choosing another number from the 2**256 range. The universe will be long dead before that happens,
         so using UniformRandomNumber.sol instead of the one-liner here would effectively be adding dead code.
        */
    }
}
