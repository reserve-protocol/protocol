// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IExchangeRateOracle } from "./IExchangeRateOracle.sol";
import { IRToken } from "../../../interfaces/IRToken.sol";
import { IMain } from "../../../interfaces/IMain.sol";
import { IAssetRegistry } from "../../../interfaces/IAssetRegistry.sol";
import { IAsset } from "../../../interfaces/IAsset.sol";

/**
 * @title ReferenceRateOracle
 * @notice An immutable Reference Rate Oracle for an RToken (eg: ETH+/USD)
 *
 * Composes oracles used by the protocol internally to calculate the reference price of an RToken,
 * in UoA terms, usually USD.
 *
 * ::Notice::
 * The oracle does not call refresh() on the RToken or the underlying assets, so the price can be
 * stale. This is generally not an issue for active RTokens as they are refreshed often by other
 * protocol operations, however do keep this in mind when using this for low-activity RTokens.
 *
 * If you need the freshest possible price, consider using RTokenAsset.latestPrice() instead,
 * however it is a mutator function instead of a view-only function hence not compatible with
 * Chainlink style interfaces.
 *
 * ::Warning::
 * In the event of an RToken taking a loss in excess of the StRSR over-collateralization
 * layer, the devaluation will not be reflected until the RToken is done trading. This causes
 * the exchange rate to be too high during the rebalancing phase. If the exchange rate is relied
 * upon naively, then it could be misleading.
 *
 * As a consumer of this oracle, you may want to guard against this case by monitoring:
 *     `rToken.status() == 0 && rToken.fullyCollateralized()`
 *
 * However, note that `fullyCollateralized()` is extremely gas-costly. We recommend executing
 * the function off-chain. `status()` is cheap and more reasonable to be called on-chain.
 */
contract ReferenceRateOracle is IExchangeRateOracle {
    error MissingRToken();

    IRToken public immutable rToken;
    uint256 public constant override version = 1;

    constructor(address _rToken) {
        // allow address(0)
        rToken = IRToken(_rToken);
    }

    function decimals() external view override returns (uint8) {
        return rToken.decimals();
    }

    function description() external view override returns (string memory) {
        return string.concat(rToken.symbol(), " Reference Rate Oracle");
    }

    function exchangeRate() public view returns (uint256) {
        if (address(rToken) == address(0)) {
            revert MissingRToken();
        }

        IMain main = rToken.main();
        IAssetRegistry assetRegistry = main.assetRegistry();
        IAsset rTokenAsset = assetRegistry.toAsset(IERC20(address(rToken)));

        (uint256 lower, uint256 upper) = rTokenAsset.price();
        require(lower != 0 && upper < type(uint192).max, "invalid price");

        return (lower + upper) / 2;
    }

    /**
     * @dev Ignores roundId completely, prefer using latestRoundData()
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
