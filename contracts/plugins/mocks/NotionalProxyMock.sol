// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/INotionalProxy.sol";

contract NotionalProxyMock is INotionalProxy {

    uint256 claimedTokens;

    function setClaimedTokens(uint256 _amount) external {
        claimedTokens = _amount;
    }

    function nTokenClaimIncentives() external returns (uint256) {
        return claimedTokens;
    }
}
