// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IAsset.sol";

interface IClaimAdapter {
    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(ICollateral) external returns (address _to, bytes memory _calldata);
}
