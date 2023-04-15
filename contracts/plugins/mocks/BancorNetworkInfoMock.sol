// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../../libraries/Fixed.sol";

struct WithdrawalAmounts {
    uint256 totalAmount;
    uint256 baseTokenAmount;
    uint256 bntAmount;
}

interface IBancorNetworkInfo {
    /**
     * @dev converts the specified underlying base token amount to pool token amount
     */
    function underlyingToPoolToken(address pool, uint256 tokenAmount) external view returns (uint256);
    /**
     * @dev returns the amounts that would be returned if the position is currently withdrawn,
     * along with the breakdown of the base token and the BNT compensation
     */
    function withdrawalAmounts(address pool, uint256 poolTokenAmount) external view returns (WithdrawalAmounts memory);
}

contract BancorNetworkInfoMock is IBancorNetworkInfo {
    using FixLib for uint192;

    uint192 public lp_conversion;
    uint192 public withdraw_conversion;
    uint8 public decimals;

    constructor(uint192 _lp_conversion, uint192 _withdraw_conversion, uint8 _decimals) {
        lp_conversion = _lp_conversion;
        withdraw_conversion = _withdraw_conversion;
        decimals = _decimals;
    }

    function setLPConversion(uint192 _lp_conversion) external {
        lp_conversion = _lp_conversion;
    }

    function setWithdrawConversion(uint192 _withdraw_conversion) external {
        withdraw_conversion = _withdraw_conversion;
    }

    function _underlyingToPoolToken(uint256 tokenAmount) internal view returns (uint256) {
        return shiftl_toFix(tokenAmount, 0 - int8(decimals)).mul(lp_conversion).shiftl_toUint(int8(decimals));
    }

    function underlyingToPoolToken(address pool, uint256 tokenAmount) external view override returns (uint256) {
        return _underlyingToPoolToken(tokenAmount);
    }

    function withdrawalAmounts(address pool, uint256 poolTokenAmount) external view override returns (WithdrawalAmounts memory) {
        return WithdrawalAmounts(
            _underlyingToPoolToken(poolTokenAmount),
            shiftl_toFix(_underlyingToPoolToken(poolTokenAmount), 0 - int8(decimals)).mul(withdraw_conversion).shiftl_toUint(int8(decimals)),
            0
        );
    }
}
