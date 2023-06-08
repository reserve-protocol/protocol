// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract CometHelpers {
    uint64 internal constant BASE_INDEX_SCALE = 1e15;
    uint256 public constant EXP_SCALE = 1e18;
    uint256 public constant BASE_SCALE = 1e6;

    error InvalidUInt64();
    error InvalidUInt104();
    error InvalidInt256();
    error NegativeNumber();

    function safe64(uint256 n) internal pure returns (uint64) {
        // untested:
        //     comet code, overflow is hard to cover
        if (n > type(uint64).max) revert InvalidUInt64();
        return uint64(n);
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
        // untested:
        //     comet code, overflow is hard to cover
        if (n > type(uint104).max) revert InvalidUInt104();
        return uint104(n);
    }

    /**
     * @dev Multiply a number by a factor
     */
    function mulFactor(uint256 n, uint256 factor) internal pure returns (uint256) {
        return (n * factor) / EXP_SCALE;
    }

    function divBaseWei(uint256 n, uint256 baseWei) internal pure returns (uint256) {
        return (n * BASE_SCALE) / baseWei;
    }
}
