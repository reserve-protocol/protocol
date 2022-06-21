// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/FiatCollateral.sol";
import "contracts/interfaces/IMain.sol";

contract EURAavePricedFiatCollateral is FiatCollateral {
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        FiatCollateral(
            main_,
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            erc20_
        )
    {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return main.oracle().priceEUR(bytes32(bytes(referenceERC20.symbol())));
    }
}
