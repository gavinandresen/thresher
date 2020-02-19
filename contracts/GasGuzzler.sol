/*
 * Gas-guzzling contract, just for testing
 */

pragma solidity ^0.5.8;

import { Thresher } from "./Thresher.sol";

contract GasGuzzler {
    uint256[] public stuff;

    function () external payable {
        // I want this to consume at least 200,000 gas;
        // SSTORE costs 20,000 gas for a new item, so
        // store 10:
        uint256 start = stuff.length;
        stuff.length += 10;
        for (uint256 i = start; i < stuff.length; i++) {
            stuff[i] = i+11;
        }
    }

    function contribute(address payable thresherAddress, uint256 _winAmount) external payable {
        Thresher t = Thresher(thresherAddress);
        t.contribute.value(msg.value)(_winAmount);
    }

    function destroy() external {
        // Allow anybody to reclaim any ETH (this is just for testing):
        selfdestruct(msg.sender);
    }
}