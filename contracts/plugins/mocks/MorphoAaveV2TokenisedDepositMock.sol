// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { MorphoAaveV2TokenisedDeposit, MorphoAaveV2TokenisedDepositConfig } from "../assets/morpho-aave/MorphoAaveV2TokenisedDeposit.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { shiftl_toFix } from "../../libraries/Fixed.sol";

contract MorphoAaveV2TokenisedDepositMock is MorphoAaveV2TokenisedDeposit {
    using Math for uint256;

    constructor(MorphoAaveV2TokenisedDepositConfig memory config)
        MorphoAaveV2TokenisedDeposit(config)
    {}

    uint192 internal exchangeRate = 10**18;

    function setExchangeRate(uint192 rate) external {
        exchangeRate = rate;
    }

    function getExchangeRate() external view returns (uint192) {
        return exchangeRate;
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        uint256 out = shares.mulDiv(
            totalAssets() + 1,
            totalSupply() + 10**_decimalsOffset(),
            rounding
        );

        return (out * exchangeRate) / 10**18;
    }
}
