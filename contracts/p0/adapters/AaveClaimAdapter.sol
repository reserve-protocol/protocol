// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";

/// Supports composing calldata to claim rewards in a small number of defi protocols
contract AaveClaimAdapterP0 is IClaimAdapter {
    /// @return _to The address to send the call to. The zero address if no call is required.
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
