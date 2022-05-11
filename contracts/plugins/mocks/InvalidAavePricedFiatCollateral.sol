// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/AavePricedFiatCollateral.sol";

contract InvalidAavePricedFiatCollateral is AavePricedFiatCollateral {
    bool public shouldFailAssert;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    )
        AavePricedFiatCollateral(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            comptroller_,
            aaveLendingPool_
        )
    {}

    function setShouldFailAssert(bool newValue) external {
        shouldFailAssert = newValue;
    }

    // Dummy implementation - Reverts or fails an assertion - Testing Purposes
    function price() public view override returns (int192) {
        if (shouldFailAssert) {
            assert(false);
        } else {
            revert();
        }
        return consultOracle(erc20);
    }
}
