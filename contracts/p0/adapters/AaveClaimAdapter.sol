// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";

/// Claim adapter for the Compound protocol
contract AaveClaimAdapterP0 is IClaimAdapter {
    address public immutable override rewardERC20;

    constructor(address rewardERC20_) {
        rewardERC20 = rewardERC20_;
    }

    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(ICollateral collateral)
        external
        view
        override
        returns (address _to, bytes memory _calldata)
    {
        _to = address(collateral.erc20()); // this should be a StaticAToken
        _calldata = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}
