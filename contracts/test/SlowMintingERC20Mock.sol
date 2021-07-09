// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../RToken.sol";

contract SlowMintingERC20Mock is RToken {

    function startMinting(address account, uint256 amount) public {
        _startSlowMinting(account, amount);
    }

    function issuanceRate() external view returns (uint256) {
        return config.issuanceRate;
    }
}
