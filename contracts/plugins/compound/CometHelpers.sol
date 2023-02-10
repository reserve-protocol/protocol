// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

contract CometHelpers {
    uint64 internal constant BASE_INDEX_SCALE = 1e15;
    uint256 public constant EXP_SCALE = 1e18;

    error InvalidUInt64();
    error InvalidUInt104();
    error InvalidInt256();
    error NegativeNumber();

    function safe64(uint256 n) internal pure returns (uint64) {
        if (n > type(uint64).max) revert InvalidUInt64();
        return uint64(n);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }

    function presentValueSupply(uint64 baseSupplyIndex_, uint104 principalValue_)
        internal
        pure
        returns (uint256)
    {
        return (uint256(principalValue_) * baseSupplyIndex_) / BASE_INDEX_SCALE;
    }

    function principalValueSupply(uint64 baseSupplyIndex_, uint256 presentValue_)
        internal
        pure
        returns (uint104)
    {
        return safe104((presentValue_ * BASE_INDEX_SCALE) / baseSupplyIndex_);
    }

    function safe104(uint256 n) internal pure returns (uint104) {
        if (n > type(uint104).max) revert InvalidUInt104();
        return uint104(n);
    }

    function unsigned256(int256 n) internal pure returns (uint256) {
        if (n < 0) revert NegativeNumber();
        return uint256(n);
    }

    /**
     * @dev Multiply a number by a factor
     */
    function mulFactor(uint256 n, uint256 factor) internal pure returns (uint256) {
        return (n * factor) / EXP_SCALE;
    }
}
