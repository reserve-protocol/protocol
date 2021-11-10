// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../libraries/Basket.sol";
import "../libraries/Token.sol";

contract BasketCallerMock {
    using Basket for Basket.Info;
    using Token for Token.Info;

    uint256 public SCALE = 1e18;

    Basket.Info public innerBasket;

    constructor(Token.Info[] memory basketTokens) {
        innerBasket.size = uint16(basketTokens.length);
        innerBasket.inflationSinceGenesis = SCALE;
        for (uint16 i = 0; i < innerBasket.size; i++) {
            innerBasket.tokens[i] = basketTokens[i];
        }
    }

    function setTokens(Token.Info[] memory tokens) external {
        innerBasket.setTokens(tokens);
    }

    function setInflationSinceGenesis(uint256 value) external {
        innerBasket.inflationSinceGenesis = value;
    }

    function getBasketSize() external view returns (uint16) {
        return innerBasket.size;
    }

    function getInflationSinceGenesis() external view returns (uint256) {
        return innerBasket.inflationSinceGenesis;
    }

    function getTokenInfo(uint16 index) external view returns (Token.Info memory) {
        Token.Info memory _tkn = innerBasket.tokens[index];
        return _tkn;
    }

    function weight(uint256 scale, uint16 index) external view returns (uint256) {
        return innerBasket.weight(scale, index);
    }

    function issueAmounts(
        uint256 amount,
        uint256 scale,
        uint256 spread,
        uint8 decimals
    ) external view returns (uint256[] memory parts) {
        return innerBasket.issueAmounts(amount, scale, spread, decimals);
    }

    function redemptionAmounts(
        uint256 amount,
        uint256 scale,
        uint8 decimals,
        uint256 totalSupply
    ) external view returns (uint256[] memory parts) {
        return innerBasket.redemptionAmounts(amount, scale, decimals, totalSupply);
    }

    function mostUndercollateralizedAndMostOverCollateralized(
        uint256 scale,
        uint8 decimals,
        uint256 totalSupply
    ) external view returns (int32, int32) {
        return innerBasket.mostUndercollateralizedAndMostOverCollateralized(scale, decimals, totalSupply);
    }
}
