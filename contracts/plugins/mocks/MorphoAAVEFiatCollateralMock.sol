// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../assets/morpho-aave/MorphoAAVEPositionWrapper.sol";
import "../../libraries/Fixed.sol";

contract MorphoAAVEPositionWrapperMock is MorphoAAVEPositionWrapper {
    using FixLib for uint192;
    uint192 private exchange_rate;

    constructor(MorphoAAVEWrapperConfig memory config) MorphoAAVEPositionWrapper(config) {}

    function set_exchange_rate(uint192 rate) external {
        exchange_rate = rate;
    }

    function get_exchange_rate() external override view returns (uint192) {
        return exchange_rate;
    }
}
