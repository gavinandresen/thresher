/*
* Thresher accumulates small deposits until there are enough to fund a full Tornado.cash
* deposit.
*
* The problem: Tornado.cash deposits and withdrawals are fixed-size, with a minimum
* size (0.1 ETH in the case of ether). Anybody that uses tornado properly will accumulate
* less-than-minimum amounts of ETH in different addresses and be unable to spend
* them without compromising privacy.
*
* Solution: A little rolling lottery. Deposit your leftover ETH, and you'll either
* lose it or receive enough ETH to pay for a Tornado deposit (0.1 ETH plus gas costs).
* Your chances of winning are (amount you put in) / (amount if you win) -- if you
* use the contract repeatedly, you should get as much out as you put in.
*
* Winners are determined as a side effect of processing a new deposit at some current block height N.
*
* The hash of the block following each entry is used as the entropy source to decide if the
* entry wins or loses. See ATTACKS.md for why this is OK for this particular use case.
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
        uint256 winAmount;
        address payable depositor;
        uint256 blockNumber;
    }
    mapping(uint256 => Entry) internal entries;
    uint256 internal nFirst = 2**255;
    uint256 internal nLast = nFirst - 1;

    function empty() internal view returns (bool) {
        return nLast < nFirst;
    }

    function first() internal view returns (
            uint256 _amount, uint256 _winAmount, address payable _depositor,
            uint256 _blockNumber) {
        require(!empty());

        _amount = entries[nFirst].amount;
        _winAmount = entries[nFirst].winAmount;
        _depositor = entries[nFirst].depositor;
        _blockNumber = entries[nFirst].blockNumber;
    }

    function popFirst() internal {
        require(!empty());

        delete entries[nFirst];
        nFirst += 1;
    }

    function pushLast(
            uint256 _amount, uint256 _winAmount,
            address payable _depositor, uint256 _blockNumber) internal {
        nLast += 1;
        entries[nLast] = Entry(_amount, _winAmount, _depositor, _blockNumber);
    }
}

contract Thresher is EntryDeque, ReentrancyGuard {
    bytes32 public randomHash;
    uint256 public maxPayout;

    event Win(address indexed depositor);
    event Lose(address indexed depositor);
    event TransferError(address indexed depositor);

    /**
      @dev The constructor
      @param _maxPayout Maximum win amount
    **/
    constructor(uint256 _maxPayout) public {
        maxPayout = _maxPayout;
        require(maxPayout > 0);
        require(maxPayout < 4 ether); // more than twice block reward is insecure

        // initial value of randomHash is arbitrary (Gavin likes 11)
        randomHash = keccak256(abi.encode("Eleven!"));
    }

    /**
      @dev Contribute funds; rejects too-large deposits.
    **/
    function contribute(uint256 _winAmount) external payable nonReentrant {
        uint256 v = msg.value;

        require(_winAmount > 0, "Win amount must be greater than zero");
        require(_winAmount <= maxPayout, "Win amount too large");

        // Don't allow contributing more than win amount-- prevents
        // users from losing coins by sending 1 ETH and 'winning' just 0.1
        require(v <= _winAmount, "Amount too large");

        // Q: Any reason to fail if the msg.value is tiny (e.g. 1 wei)?
        // I can't see any reason to enforce a minimum; gas costs make it
        // expensive to submit lots of tiny contributions.

        uint256 currentBlock = block.number;
        pushLast(v, _winAmount, msg.sender, currentBlock);

        bool winner = false;
        bytes32 hash = randomHash;
        
        // Maximum one payout per contribution, because multiple transfers could cost a lot of gas
        // ... but usability is better (faster win/didn't win decisions) if we keep going until
        // we either pay out or don't have any entries old enough to pay out:
        while (!winner && !empty()) {
            uint256 amount;
            uint256 winAmount;
            address payable depositor;
            uint256 blockNumber;
            (amount, winAmount, depositor, blockNumber) = first();

            if (blockNumber+2 > currentBlock) {
                break;  // No entries old enough to win: do nothing
            }
            if (address(this).balance < winAmount) {
                break; // Can't payout if entry wins: do nothing
            }
            popFirst();

            // a different hash is computed for every entry to make it more difficult for somebody
            // to arrange for their own entries to win.
            // Transactions only have access to the last 256 blocks, so:
            if ((blockNumber+256) > currentBlock) {
                bytes32 b = hash ^ blockhash(blockNumber+1);
                hash = keccak256(abi.encodePacked(b));
            } else {
                // There is a very mild attack possible here if there are no contributions (or the
                // contract has a balance < winAmount) for 256 blocks (see ATTACKS.md for
                // details and mitigation strategies).
                hash = keccak256(abi.encodePacked(hash));
            }

            if (amount >= pickWinningThreshold(hash, winAmount)) {
                winner = true;

                // transfer used to be the recommended way of transferring ether,
                // but .call.value()() is now Best Practice
                // (see https://diligence.consensys.net/blog/2019/09/stop-using-soliditys-transfer-now/)
                // solhint-disable-next-line avoid-call-value
                (bool success, ) = depositor.call.value(winAmount)("");

                if (success) {
                    emit Win(depositor);
                } else {
                    // We can't require(success), because it opens up a
                    // denial-of-service attack (depositor could ask us to pay
                    // to a contract that always failed). The best we can do
                    // is log the failed payment attempt and move on.
                    emit TransferError(depositor);
                }
            } else {
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
