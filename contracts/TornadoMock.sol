pragma solidity ^0.5.8;

/*
 * Mock contract with Tornado.cash API, for testing
 */
contract TornadoMock {
    uint256 public denonimation = 0.1 ether;

    function deposit(bytes32 _commitment) external payable {
    }
}
