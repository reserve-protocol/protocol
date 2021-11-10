// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IOwner {
    function updatePrices(
        address rTokenAddress,
        uint256 insuranceTokenPrice,
        uint256[] calldata collateralTokenPrices
    ) external;
}
