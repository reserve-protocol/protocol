// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../../libraries/Fixed.sol";
import "../../../mocks/ERC20Mock.sol";
import "../interfaces/IStargatePool.sol";

contract StargatePoolMock is ERC20Mock {
    using FixLib for uint192;

    uint256 public totalLiquidity;
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20Mock(name, symbol) {
        totalLiquidity = totalSupply();
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function exchangeRate() external view returns (uint192) {
        uint256 _totalSupply = totalSupply();
        uint192 _rate = FIX_ONE; // 1:1 if pool has no tokens at all
        if (_totalSupply != 0) {
            _rate = divuu(totalLiquidity, _totalSupply);
        }

        return _rate;
    }

    function setExchangeRate(uint192 rate) external {
        uint192 fixTotalLiquidity = rate.mul(shiftl_toFix(totalSupply(), -int8(decimals())));
        totalLiquidity = shiftl_toFix(fixTotalLiquidity, -(36 - int8(decimals())));
    }
}
