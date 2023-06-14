// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { _safeWrap } from "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";

interface CBEth {
    function exchangeRate() external view returns (uint256);
    function mint(
        address account,
        uint256 amount
    ) external returns (bool);
}

contract CBEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    CBEth public immutable token;

    /// @param config.chainlinkFeed {UoA/ref} price of DAI in USD terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        token = CBEth(address(config.erc20));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (uint192 low, uint192 high, uint192 pegPrice)
    {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // {target/ref} ETH/ETH is always 1
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(token.exchangeRate());
    }
}
