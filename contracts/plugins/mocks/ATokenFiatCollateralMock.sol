// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/ATokenFiatCollateral.sol";

contract ATokenFiatCollateralMock is AaveOracleMixin, Collateral {
    uint192 private _targetPerRef;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        bytes32 targetName_,
        uint192 targetPerRef_
    ) {
        init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            comptroller_,
            aaveLendingPool_,
            targetName_,
            targetPerRef_
        );
    }

    function init(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        bytes32 targetName_,
        uint192 targetPerRef_
    ) public initializer {
        __Collateral_init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            erc20_,
            targetName_
        );
        __AaveOracleMixin_init(comptroller_, aaveLendingPool_);

        _targetPerRef = targetPerRef_;
    }

    function targetPerRef() public view override returns (uint192) {
        return _targetPerRef;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return consultOracle(erc20);
    }
}
