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
* with 0.1 ETH).
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
    }
    mapping(uint256 => Entry) internal entries;
    uint256 internal nFirst = 2**255;
    uint256 internal nLast = nFirst - 1;

    function empty() internal view returns (bool) {
        return nLast < nFirst;
    }

    function first() internal view returns (uint256 _amount, address payable _depositor, uint256 _blockNumber) {
        require(!empty());

        _amount = entries[nFirst].amount;
        _depositor = entries[nFirst].depositor;
        _blockNumber = entries[nFirst].blockNumber;
    }

    function popFirst() internal {
        require(!empty());

        delete entries[nFirst];
        nFirst += 1;
    }

    function pushLast(uint256 _amount, address payable _depositor, uint256 _blockNumber) internal {
        nLast += 1;
        entries[nLast] = Entry(_amount, _depositor, _blockNumber);
    }
}

contract Thresher is EntryDeque, ReentrancyGuard {
    bytes32 public randomHash;
    uint256 public payoutThreshold;

    event Win(address indexed depositor);
    event Lose(address indexed depositor);

    /**
      @dev The constructor
      @param _payoutThreshold Amount to accumulate / pay out (e.g. 0.1 ether)
    **/
    constructor(uint256 _payoutThreshold) public {
        // Sanity check:
        payoutThreshold = _payoutThreshold;
        require(payoutThreshold > 0);
        require(payoutThreshold < 4 ether);

        randomHash = keccak256(abi.encode("Eleven!"));
    }

    /**
      @dev Deposit funds. The caller must send less than or equal to payoutThreshold
    **/
    function () external payable nonReentrant {
        uint256 v = msg.value;
        require(v <= payoutThreshold, "Deposit amount too large");

        // Q: Any reason to fail if the msg.value is tiny (e.g. 1 wei)?
        // I can't see any reason to enforce a minimum; gas costs make attacks
        // expensive.

        uint256 currentBlock = block.number;
        pushLast(v, msg.sender, currentBlock);

        if (address(this).balance < payoutThreshold) {
            return;
        }

        bool winner = false;
        uint256 amount;
        address payable depositor;
        uint256 blockNumber;
        bytes32 hash = randomHash;
        
        // Maximum one payout per deposit, because multiple transfers could cost a lot of gas
        // ... but usability is better (faster win/didn't win decisions) if we keep going until
        // we either pay out or don't have any entries old enough to pay out:
        while (!winner) {
            (amount, depositor, blockNumber) = first();
            if (blockNumber > currentBlock-2) {
                break;
            }
            popFirst();

            // a different hash is computed for every entry to make it more difficult for somebody
            // to arrange for their own entries to win
            bytes32 b = hash ^ blockhash(currentBlock-1);
            hash = keccak256(abi.encodePacked(b));
            if (amount >= pickWinningThreshold(randomHash, payoutThreshold)) {
                winner = true;
            }
            else {
                emit Lose(depositor);
            }
        }
        randomHash = hash;
        if (winner) {
           depositor.transfer(payoutThreshold);
           emit Win(depositor);
        }
    }

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
