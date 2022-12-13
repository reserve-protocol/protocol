// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/Fixed.sol";
import "../assets/DemurrageCollateral.sol";
import "./IVaultToken.sol";
import "../assets/OracleLib.sol";

abstract contract AbstractDMVaultTokenCollateral is DemurrageCollateral {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed;
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint256 ratePerPeriod_,
        AggregatorV3Interface chainlinkFeed_,
        uint48 oracleTimeout_,
        uint256 defaultThreshold_
    )
        DemurrageCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            ratePerPeriod_
        )
    {
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        chainlinkFeed = chainlinkFeed_;
        oracleTimeout = oracleTimeout_;
        defaultThreshold = _safeWrap(defaultThreshold_);
    }

    // solhint-disable-next-line no-empty-blocks
    function claimRewards() external virtual override {}

    /// @return {uTok/tok} Quantity of whole underlying token units per whole collateral tokens
    function uTokPerTok() internal view virtual override returns (uint192) {
        IVaultToken vault = IVaultToken(address(erc20));
        uint256 pps = vault.pricePerShare();
        return shiftl_toFix(pps, -int8(vault.decimals()));
    }

    /// @return {UoA/uTok} The current price of the underlying token
    function pricePerUTok() internal view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    function _checkAndUpdateDefaultStatus() internal virtual override returns (bool isSound);
}
