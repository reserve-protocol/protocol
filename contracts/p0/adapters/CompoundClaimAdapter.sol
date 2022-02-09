// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/CompoundOracleMixin.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";

/// Claim adapter for the Compound protocol
contract CompoundClaimAdapterP0 is IClaimAdapter {
    IComptroller public immutable comptroller;

    constructor(IComptroller comptroller_) {
        comptroller = comptroller_;
    }

    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata(ICollateral)
        external
        view
        override
        returns (address _to, bytes memory _calldata)
    {
        _to = address(comptroller);
        _calldata = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
