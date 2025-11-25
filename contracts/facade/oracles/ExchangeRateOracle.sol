// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { FIX_ONE, divuu } from "../../libraries/Fixed.sol";
import { IExchangeRateOracle } from "./IExchangeRateOracle.sol";
import { IAsset } from "../../interfaces/IAsset.sol";
import { IRToken } from "../../interfaces/IRToken.sol";

/**
 * @title ExchangeRateOracle
 * @notice An immutable Exchange Rate Oracle for an RToken (eg: ETH+/ETH)
 *
 * ::Assumption::
 * Constant basket target definition of only a single target unit, of the correct magnitude.
 * For example, an ETH-pegged RToken should define the basket as 1 ETH, and a USD-pegged RToken
 * should define the basket as 1 USD. The basket target units should not be redefined after.
 *
 * ::Notice::
 * The oracle does not call refresh() on the RToken, so the exchange rate can be stale.
 * This is generally not an issue for active RTokens as they are refreshed by other
 * protocol operations, however do keep this in mind when using this for low-activity RTokens.
 * This can lead to the exchange rate being underestimated by the amount of unrealized RToken
 * melting (exchange-rate appreciation).
 *
 * If you need a fresher exchange-rate, consider calling `furnace.melt()` or
 * `RTokenAsset.refresh()`. Note these are mutators, and hence not compatible with
 * Chainlink style interfaces.
 *
 * ::Warning::
 * In the event of an RToken taking a loss in excess of the StRSR overcollateralization
 * layer, the devaluation will not be reflected until the RToken is done trading. This causes
 * the exchange rate to be too high during the rebalancing phase. If the exchange rate is relied
 * upon naively, then it could be misleading.
 *
 * As a consumer of this oracle, you may want to guard against this case by monitoring:
 *     `basketHandler.status() == 0 && basketHandler.fullyCollateralized()`
 * where `basketHandler` can be safely cached from `rToken.main().basketHandler()`.
 *
 * However, note that `fullyCollateralized()` is extremely gas-costly. We recommend executing
 * the function off-chain. `status()` is cheap and more reasonable to be called on-chain.
 *
 */
contract ExchangeRateOracle is IExchangeRateOracle {
    error ZeroAddress();

    IRToken public immutable rToken;
    uint256 public constant override version = 1;

    constructor(address _rToken) {
        if (_rToken == address(0)) {
            revert ZeroAddress();
        }

        rToken = IRToken(_rToken);
    }

    function decimals() external pure override returns (uint8) {
        return 18;
    }

    function description() external view override returns (string memory) {
        return string.concat(rToken.symbol(), " Exchange Rate Oracle");
    }

    function exchangeRate() public view returns (uint256) {
        uint256 supply = IRToken(rToken).totalSupply();
        if (supply == 0) {
            return FIX_ONE;
        }

        return divuu(uint256(IRToken(rToken).basketsNeeded()), supply);
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
