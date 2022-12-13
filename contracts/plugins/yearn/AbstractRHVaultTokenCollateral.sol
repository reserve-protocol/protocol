// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/Fixed.sol";
import "../assets/RevenueHidingCollateral.sol";
import "./IVaultToken.sol";
import "../assets/OracleLib.sol";

abstract contract AbstractRHVaultTokenCollateral is RevenueHidingCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    AggregatorV3Interface public immutable chainlinkFeed;
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint16 basisPoints_,
        AggregatorV3Interface chainlinkFeed_,
        uint48 oracleTimeout_,
        uint256 defaultThreshold_
    )
        RevenueHidingCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            basisPoints_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        defaultThreshold = _safeWrap(defaultThreshold_);
        chainlinkFeed = chainlinkFeed_;
        oracleTimeout = oracleTimeout_;
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    function strictPrice() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout).mul(actualRefPerTok());
    }

    /// @return {ref/tok} Quantity of whole reference units (actual) per whole collateral tokens
    function actualRefPerTok() public view virtual override returns (uint192) {
        IVaultToken vault = IVaultToken(address(erc20));
        uint256 pps = vault.pricePerShare();
        return shiftl_toFix(pps, -int8(vault.decimals()));
    }

    // solhint-disable-next-line no-empty-blocks
    function claimRewards() external virtual override {}
}
