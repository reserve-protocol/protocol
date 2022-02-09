// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/assets/abstract/CompoundOracleMixin.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/CommonErrors.sol";

/// Supports composing calldata to claim rewards in a small number of defi protocols
contract ClaimAdapterP0 is IClaimAdapter {
    IComptroller public immutable comptroller;
    IAaveLendingPool public immutable aaveLendingPool;

    constructor(IComptroller comptroller_, IAaveLendingPool aaveLendingPool_) {
        comptroller = comptroller_;
        aaveLendingPool = aaveLendingPool_;
    }

    /// @return _to The address to send the call to. The zero address if no call is required.
    /// @return _calldata The calldata to send
    function getClaimCalldata(ICollateral collateral)
        external
        view
        override
        returns (address _to, bytes memory _calldata)
    {
        _to = collateral.defiProtocol();

        if (_to == address(comptroller)) {
            _calldata = abi.encodeWithSignature("claimComp(address)", msg.sender);
        } else if (_to == address(aaveLendingPool)) {
            _to = address(collateral.erc20());
            _calldata = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
        }
    }
}
