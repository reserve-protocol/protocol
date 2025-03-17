// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

/**
 * @title DecimalsCorrectionLibrary
 * @author RedDuck Software
 */
library DecimalsCorrectionLibrary {
    /**
     * @dev converts `originalAmount` with `originalDecimals` into
     * amount with `decidedDecimals`
     * @param originalAmount amount to convert
     * @param originalDecimals decimals of the original amount
     * @param decidedDecimals decimals for the output amount
     * @return amount converted amount with `decidedDecimals`
     */
    function convert(
        uint256 originalAmount,
        uint256 originalDecimals,
        uint256 decidedDecimals
    ) internal pure returns (uint256) {
        if (originalAmount == 0) return 0;
        if (originalDecimals == decidedDecimals) return originalAmount;

        uint256 adjustedAmount;

        if (originalDecimals > decidedDecimals) {
            adjustedAmount = originalAmount / (10**(originalDecimals - decidedDecimals));
        } else {
            adjustedAmount = originalAmount * (10**(decidedDecimals - originalDecimals));
        }

        return adjustedAmount;
    }

    /**
     * @dev converts `originalAmount` with decimals 18 into
     * amount with `decidedDecimals`
     * @param originalAmount amount to convert
     * @param decidedDecimals decimals for the output amount
     * @return amount converted amount with `decidedDecimals`
     */
    function convertFromBase18(uint256 originalAmount, uint256 decidedDecimals)
        internal
        pure
        returns (uint256)
    {
        return convert(originalAmount, 18, decidedDecimals);
    }

    /**
     * @dev converts `originalAmount` with `originalDecimals` into
     * amount with decimals 18
     * @param originalAmount amount to convert
     * @param originalDecimals decimals of the original amount
     * @return amount converted amount with 18 decimals
     */
    function convertToBase18(uint256 originalAmount, uint256 originalDecimals)
        internal
        pure
        returns (uint256)
    {
        return convert(originalAmount, originalDecimals, 18);
    }
}
