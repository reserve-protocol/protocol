// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { OracleLib } from "../OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { shiftl_toFix, FIX_ONE } from "../../../libraries/Fixed.sol";
import { IERC4626 } from "../../../vendor/oz/IERC4626.sol";

interface IMetaMorpho is IERC4626 {
    function lastTotalAssets() external view returns (uint256);

    function fee() external view returns (uint96);

    // solhint-disable-next-line func-name-mixedcase
    function DECIMALS_OFFSET() external view returns (uint8);
}
