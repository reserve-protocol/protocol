// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";

/// Claim adapter for the Compound protocol
contract AaveClaimAdapterP0 is IClaimAdapter {
    IERC20Metadata public immutable override rewardERC20;

    constructor(IERC20Metadata rewardERC20_) {
        rewardERC20 = rewardERC20_;
    }

    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(IERC20Metadata tok)
        external
        pure
        override
        returns (address _to, bytes memory _calldata)
    {
        _to = address(tok); // this should be a StaticAToken
        _calldata = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}
