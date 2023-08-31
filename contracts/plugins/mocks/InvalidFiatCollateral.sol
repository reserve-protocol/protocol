// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/FiatCollateral.sol";

contract InvalidFiatCollateral is FiatCollateral {
    using FixLib for uint192;

    bool public simplyRevert;

    bool public unpriced;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    // Mock price function, reverts with specific error or runs out of gas
    function price() public view virtual override(Asset, IAsset) returns (uint192, uint192) {
        if (simplyRevert) {
            revert("errormsg"); // Revert with no reason
        } else if (unpriced) {
            return (0, FIX_MAX);
        } else {
            // Run out of gas
            this.infiniteLoop{ gas: 10 }();
        }

        // Mock values, will not be used
        return (1e18, 1e18);
    }

    function setSimplyRevert(bool on) external {
        simplyRevert = on;
    }

    function setUnpriced(bool on) external {
        unpriced = on;
    }

    function infiniteLoop() external pure {
        uint256 i = 0;
        uint256[1] memory array;
        while (true) {
            array[0] = i;
            i++;
        }
    }
}
