// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/FiatCollateral.sol";

contract GasGuzzlingFiatCollateral is FiatCollateral {
    using FixLib for uint192;

    bool public revertRefPerTok;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    function refPerTok() public view virtual override returns (uint192) {
        if (revertRefPerTok) {
            // Use up all gas available
            this.infiniteLoop();
        }

        return 1e18;
    }

    function setRevertRefPerTok(bool on) external {
        revertRefPerTok = on;
    }

    function infiniteLoop() external pure {
        uint256 n = 2;
        for (uint256 i = 0; ; ++i) {
            unchecked {
                n = n**2;
            }
        }
    }
}
