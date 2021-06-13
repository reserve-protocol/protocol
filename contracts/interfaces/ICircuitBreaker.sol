pragma solidity 0.8.4;

interface ICircuitBreaker {
    function check() public view returns (bool);
}
