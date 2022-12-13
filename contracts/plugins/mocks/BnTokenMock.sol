// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract BnTokenMock is ERC20Mock {
    uint256 private underlying;
    constructor(
        string memory name,
        string memory symbol
    ) ERC20Mock(name, symbol) {
        underlying =0;
    }

    function setUnderlying(uint256 _amount) external {
        underlying = _amount;
    }

     function poolTokenToUnderlying(address pool, uint256 poolTokenAmount) external view returns (uint256){
        return underlying;
    }
}
