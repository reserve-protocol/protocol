// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "./ERC20Mock.sol";

contract StarUSDCMock is ERC20Mock {
    // solhint-disable-next-line no-empty-blocks
    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    uint256 private _totalLiqudity = 0;
    uint256 private _totalSupply = 0;

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function totalLiquidity() external view returns (uint256) {
        return _totalLiqudity;
    }
    function setTotalLiquidity(uint256 totalLiquidity) external {
        _totalLiqudity = totalLiquidity;
    }

    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }
    function setTotalSupply(uint256 totalSupply) external {
        _totalSupply = totalSupply;
    }

}
