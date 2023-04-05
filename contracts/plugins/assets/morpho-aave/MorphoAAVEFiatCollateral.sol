// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../AppreciatingFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "./MorphoAAVEPositionWrapper.sol";

contract MorphoAAVEFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    MorphoAAVEPositionWrapper wrapper;

    constructor(
        CollateralConfig memory config,
        uint192 revenue_hiding
    ) AppreciatingFiatCollateral(config, revenue_hiding) {
        require(address(config.erc20) != address(0), "missing erc20");
        wrapper = MorphoAAVEPositionWrapper(address(config.erc20));
    }

    function refresh() public virtual override {
        wrapper.refresh_exchange_rate();
        super.refresh();
    }

    function _underlyingRefPerTok() internal view override returns (uint192) {
        return wrapper.get_exchange_rate();
    }

    function claimRewards() external virtual override(Asset, IRewardable) {
        // unfortunately Morpho uses a rewards scheme that requires the results 
        // of off-chain computation to be piped into an on-chain function,
        // which is not possible to do with Reserve's collateral plugin interface.

        // https://integration.morpho.xyz/track-and-manage-position/manage-positions-on-morpho/claim-morpho-rewards

        // claiming rewards for this wrapper can be done by any account, and must be done on the rewards distributor contract
        // https://etherscan.io/address/0x3b14e5c73e0a56d607a8688098326fd4b4292135
    }
}
