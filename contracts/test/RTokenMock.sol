
// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../RToken.sol";

contract RTokenMock is RToken {

    function maxSupply() external view returns(uint256) {
        return config.maxSupply;
    }
    
    function issuanceRate() external view returns(uint256) {
        return config.issuanceRate;
    }

    function circuitBreaker() external view returns(address) {
        return address(config.circuitBreaker);
    }      

    function startMinting(address account, uint256 amount) public {
        _startSlowMinting(account, amount);
    }   

    function tryProcessMintings() public {
        _tryProcessMintings();
    }
}