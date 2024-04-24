// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../../../vendor/oz/IERC4626.sol";
import "../AppreciatingFiatCollateral.sol";

interface IStakedFrax is IERC4626 {
    function syncRewardsAndDistribution() external;
}

/**
 * @title sFRAX Collateral
 * @notice Collateral plugin for staked FRAX (sFRAX)
 * tok = sFRAX (ERC4626 vault)
 * ref = FRAX
 * tar = USD
 * UoA = USD
 */
contract SFraxCollateral is AppreciatingFiatCollateral {
    // solhint-disable no-empty-blocks

    /// @param config.chainlinkFeed {UoA/ref} price of DAI in USD terms
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }

    function refresh() public virtual override {
        try IStakedFrax(address(erc20)).syncRewardsAndDistribution() {} catch {}

        super.refresh();
    }

    // solhint-enable no-empty-blocks

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return
            divuu(
                IStakedFrax(address(erc20)).totalAssets(),
                IStakedFrax(address(erc20)).totalSupply()
            );
    }
}
