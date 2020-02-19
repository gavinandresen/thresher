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
    uint256 constant TRANSFER_GAS_ALLOWANCE = 50000; // Enough for transfers or simple contracts

    bytes32 public randomHash;
    uint256 public maxPayout;

    event Contribute(address indexed depositor);
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
      @dev Donate funds; use this to 'prime' the contact so users don't have to wait for win payouts
    **/
    function increaseBalance() external payable {
    }

    /**
      @dev Process oldest entry, if possible.
      @return true if an entry was processed
    **/
    function processOldest() private nonReentrant returns (bool) {
        if (empty()) {
            return false;
        }

        uint256 currentBlock = block.number;
        uint256 amountContributed;
        uint256 winAmount;
        address payable depositor;
        uint256 blockNumber;
        (amountContributed, winAmount, depositor, blockNumber) = first();

        if (blockNumber+2 > currentBlock) {
            return false;  // No entries old enough to win: do nothing
        }
        if (address(this).balance < winAmount) {
            return false; // Can't payout if entry wins: do nothing
        }
        popFirst();

        uint256 winningThreshold = ~uint256(0); // bitwise-not-0 == max uint256 value == always lose

        // Transactions only have access to the last 256 blocks, so:
        if ((blockNumber+256) > currentBlock) {
            // a different hash is computed for every entry to make it more difficult for somebody
            // to arrange for their own entries to win
            bytes32 b = randomHash ^ blockhash(blockNumber+1);
            randomHash = keccak256(abi.encodePacked(b));
            winningThreshold = pickWinningThreshold(randomHash, winAmount);
        }
        // Old entries always lose. It is up to the consumers of this contract to
        // make sure they are processed before 256 blocks go by.

        if (amountContributed >= winningThreshold) {
            // transfer used to be the recommended way of transferring ether,
            // but .call.value()() is now Best Practice
            // (see https://diligence.consensys.net/blog/2019/09/stop-using-soliditys-transfer-now/)
            // solhint-disable-next-line avoid-call-value
            (bool success, ) = depositor.call.gas(TRANSFER_GAS_ALLOWANCE).value(winAmount)("");

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
        return true;
    }

    // Return a number between 0 and max, given a random hash:
    function pickWinningThreshold(bytes32 hash, uint256 max) internal pure returns (uint256) {
        return uint256(hash) % max;

        /*
         Lets talk about modulo bias here, because I know somebody is going to complain.
         We could do this:
              https://github.com/pooltogether/pooltogether-contracts/blob/master/contracts/UniformRandomNumber.sol
         ... but is the extra code worth the gas cost?
         Lets play computer with uint256 (2**256) and a 10*18 (1 eth) win amount: compute
         how many values we should skip to avoid any bias:
         min = (2**256 - 10**18) % 10**18
             584,007,913,129,639,936  <<- The first 584 quadrillion hashes are biased!  But:
         2**256 / 584007913129639936L
              198271438852254556318206583738339193877760096077732688804486L
         This is how many times we'd need to call this routine before running into modulo bias and
         choosing another number from the 2**256 range. The universe will be long dead before that happens,
         so using UniformRandomNumber.sol instead of the one-liner here would effectively be adding dead code.
        */
    }

    /**
      @dev Contribute funds; rejects too-large deposits.
    **/
    function contribute(uint256 _winAmount) external payable {
        uint256 v = msg.value;

        require(_winAmount > 0, "Win amount must be greater than zero");
        require(_winAmount <= maxPayout, "Win amount too large");
        require(address(this).balance >= _winAmount, "Balance too low");

        // Don't allow contributing more than win amount-- prevents
        // users from losing coins by sending 1 ETH and 'winning' just 0.1
        require(v <= _winAmount, "Amount too large");

        // Q: Any reason to fail if the msg.value is tiny (e.g. 1 wei)?
        // I can't see any reason to enforce a minimum; gas costs make it
        // expensive to submit lots of tiny contributions.

        uint256 currentBlock = block.number;
        pushLast(v, _winAmount, msg.sender, currentBlock);

        emit Contribute(msg.sender);

        // Require entries include enough gas to pay out
        // a previous winner. 45,000 is a little more than the
        // amount of gas processOldest() consumes, without
        // a transfer to a winner.
        require (gasleft() > (45000+TRANSFER_GAS_ALLOWANCE));
        processOldest();
    }

    /**
      @dev Process all entries older than 2 blocks (or as many as we can before we run out of gas)
    **/
    function processAll() external {
        while ((gasleft() > (45000+TRANSFER_GAS_ALLOWANCE)) && processOldest()) {
        }
    }
}
