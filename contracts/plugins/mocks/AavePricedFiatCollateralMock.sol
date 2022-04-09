// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";

contract AavePricedFiatCollateralMock is AaveOracleMixin, Collateral {
    int192 private _targetPerRef;

    constructor(
        IERC20Metadata erc20_,
        uint256 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        bytes32 targetName_,
        int192 targetPerRef_
    )
        Collateral(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            erc20_,
            targetName_
        )
        AaveOracleMixin(comptroller_, aaveLendingPool_)
    {
        _targetPerRef = targetPerRef_;
    }

    function targetPerRef() public view override returns (int192) {
        return _targetPerRef;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (int192) {
        return consultOracle(erc20);
    }
}
