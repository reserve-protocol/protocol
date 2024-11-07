// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { FIX_ONE, divuu } from "../../../libraries/Fixed.sol";
import { IExchangeRateOracle } from "./IExchangeRateOracle.sol";

interface IMinimalRToken {
    function basketsNeeded() external view returns (uint192);

    function totalSupply() external view returns (uint256);
}

/**
 * @title ExchangeRateOracle
 * @notice An immutable Exchange Rate Oracle for an RToken
 *
 * ::Warning:: In the event of an RToken taking a loss in excess of the StRSR overcollateralization
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
contract ExchangeRateOracle is IExchangeRateOracle {
    error MissingRToken();

    address public immutable rToken;

    constructor(address _rToken) {
        // allow address(0)
        rToken = _rToken;
    }

    function exchangeRate() public view returns (uint256) {
        if (rToken == address(0)) {
            revert MissingRToken();
        }

        uint256 supply = IMinimalRToken(rToken).totalSupply();
        if (supply == 0) {
            return FIX_ONE;
        }

        return divuu(uint256(IMinimalRToken(rToken).basketsNeeded()), supply);
    }

    function latestRoundData()
        external
        view
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

    function decimals() external pure returns (uint8) {
        return 18; // RToken is always 18 decimals
    }
}
