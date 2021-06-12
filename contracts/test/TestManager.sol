pragma solidity 0.5.7;

import "../Manager.sol";

/**
 * @dev A version of the Manager for testing upgrades.
 */
contract ManagerV2 is Manager {

    uint256 public constant VERSION = 2;

    constructor(
        address vaultAddr,
        address rsvAddr,
        address proposalFactoryAddr,
        address basketAddr,
        address operatorAddr,
        uint256 _seigniorage
    ) Manager(
        vaultAddr, 
        rsvAddr, 
        proposalFactoryAddr, 
        basketAddr, 
        operatorAddr, 
        _seigniorage
    ) public {}
}
