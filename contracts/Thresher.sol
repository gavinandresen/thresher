pragma solidity ^0.5.8;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Tornado {
    function deposit(bytes32 _commitment) external payable;
}

/**
   Double-ended queue of entries.
   Functions not used by Thresher have been removed
   (resurrect them from git history if necessary)
 **/
contract EntryDeque {
    struct Entry {
        uint256 amount;
        bytes32 commitment; // aka tornado.cash 'note' / pedersen commitment
        uint256 blockNumber;
    }
    mapping(uint256 => Entry) entries;
    uint256 nFirst = 2**255;
    uint256 nLast = nFirst - 1;

    function empty() internal view returns (bool) {
        return nLast < nFirst;
    }

    function first() internal view returns (uint256 _amount, bytes32 _commitment, uint256 _blockNumber) {
        require(!empty());

        _amount = entries[nFirst].amount;
        _commitment = entries[nFirst].commitment;
        _blockNumber = entries[nFirst].blockNumber;
    }

    function popFirst() internal returns (uint256 _amount, bytes32 _commitment, uint256 _blockNumber) {
        (_amount, _commitment, _blockNumber) = first();

        delete entries[nFirst];
        nFirst += 1;
    }

    function pushLast(uint256 _amount, bytes32 _commitment, uint256 _blockNumber) internal {
        nLast += 1;
        entries[nLast] = Entry(_amount, _commitment, _blockNumber);
    }
}

contract Thresher is EntryDeque, ReentrancyGuard {
    address tornadoAddress;
    uint256 payoutThreshold;
    bytes32 randomHash;

    event Win(bytes32 indexed commitment);
    event Lose(bytes32 indexed commitment);

    constructor(address payable _tornadoAddress, uint256 _payoutThreshold) public {
        require(_payoutThreshold > 0);

        tornadoAddress = _tornadoAddress;
        payoutThreshold = _payoutThreshold;
        randomHash = keccak256(abi.encode("Eleven!"));
    }

    function deposit(bytes32 _commitment) external payable nonReentrant {
        uint256 v = msg.value;
        require(v <= payoutThreshold, "Deposit amount too large");

        // Q: Any reason to fail if the msg.value is tiny (e.g. 1 wei)?
        // I can't see any reason to enforce a minimum; gas costs make attacks
        // expensive.
        // Q: any reason to check gasleft(), or just let the deposit fail if
        // the user doesn't include enough gas for the tornado deposit?

        uint256 currentBlock = block.number;
        pushLast(v, _commitment, currentBlock);

        if (address(this).balance < payoutThreshold) {
            return;
        }

        bool winner = false;
        uint256 amount;
        bytes32 commitment;
        uint256 blockNumber;
        
        // Maximum one payout per deposit, because multiple tornado deposits could cost a lot of gas
        // ... but usability is better (faster win/didn't win decisions) if we keep going until
        // we either pay out or don't have any entries old enough to pay out:
        while (!winner) {
            (amount, commitment, blockNumber) = first();
            if (blockNumber > currentBlock-2) {
                break;
            }
            popFirst();

            // a different hash is computed for every entry to make it more difficult for a miner
            // to arrange for their own entries to win.
            bytes32 b = randomHash ^ blockhash(currentBlock-1);
            randomHash = keccak256(abi.encodePacked(b));
            if (amount >= pickWinningThreshold(randomHash, payoutThreshold)) {
                winner = true;
            }
            else {
                emit Lose(commitment);
            }
        }
        if (winner) {
           Tornado t = Tornado(tornadoAddress);
           t.deposit.value(payoutThreshold)(commitment);
           emit Win(commitment);
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
