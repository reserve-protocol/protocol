// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { FIX_MAX } from "../../libraries/Fixed.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IExchangeRateOracle } from "./IExchangeRateOracle.sol";
import { IRToken } from "../../interfaces/IRToken.sol";
import { IAssetRegistry } from "../../interfaces/IAssetRegistry.sol";
import { IAsset } from "../../interfaces/IAsset.sol";

/**
 * @title ReferenceRateOracle
 * @notice An immutable Reference Rate Oracle for an RToken (eg: ETH+/USD)
 *
 * Composes oracles used by the protocol internally to calculate the reference price of an RToken,
 * in UoA terms, usually USD. Inherits the deviations of the underlying oracles in proportion to
 * their presence in the basket by value. Refer to `RTokenAsset.tryPrice()` for more detailed
 * information about the pricing method.
 *
 * ::Notice::
 * The oracle does not call refresh() on the RToken or the underlying assets, so the price can be
 * stale. This is generally not an issue for active RTokens as they are refreshed often by other
 * protocol operations, however do keep this in mind when using this for low-activity RTokens.
 *
 * If you need a fresher price, consider using `RTokenAsset.latestPrice()` instead. Precede with a
 * call to `RTokenAsset.forceUpdatePrice()` if a 15-minute caching period is not acceptable.
 * However, note both these functions are mutators, and hence not compatible with
 * Chainlink style interfaces (and can revert).
 */
contract ReferenceRateOracle is IExchangeRateOracle {
    error ZeroAddress();

    uint256 public constant override version = 1;

    IRToken public immutable rToken;
    IAssetRegistry public immutable assetRegistry;

    constructor(address _rToken) {
        if (_rToken == address(0)) {
            revert ZeroAddress();
        }

        rToken = IRToken(_rToken);
        assetRegistry = IRToken(_rToken).main().assetRegistry();
    }

    function decimals() external view override returns (uint8) {
        return 18;
    }

    function description() external view override returns (string memory) {
        return string.concat(rToken.symbol(), " Reference Rate Oracle");
    }

    /**
     * @dev Can revert
     */
    function exchangeRate() public view returns (uint256) {
        // cannot cache RTokenAsset
        IAsset rTokenAsset = assetRegistry.toAsset(IERC20(address(rToken)));

        (uint256 lower, uint256 upper) = rTokenAsset.price();
        require(lower != 0 && upper < FIX_MAX, "invalid price");

        /**
         * In >=4.0.0 there is a feature called the "issuance premium",
         * which if enabled, will cause the high price to remain relatively static,
         * even when an RToken collateral is under peg.
         *
         * This is because the RToken increases issuance costs to account for the de-peg,
         * which increases the size of the price band the RToken can trade on in secondary markets.
         *
         * Using the average of the issuance redemption cost in this case can result in a quantity
         * biased upwards.
         *
         * If you need the redemption value of the RToken, do not use this approach.
         * Instead, use the `lower` price directly. Include our check above that `lower != 0`.
         */

        return (lower + upper) / 2;
    }

    /**
     * @dev Ignores roundId completely, prefer using latestRoundData()
     *      Can revert
     */
    function getRoundData(uint80)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return this.latestRoundData();
    }

    /**
     * @dev Can revert
     */
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            uint80(block.number),
            int256(exchangeRate()),
            block.timestamp - 1,
            block.timestamp,
            uint80(block.number)
        );
    }
}
